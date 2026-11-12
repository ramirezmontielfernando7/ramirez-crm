import { assertOrgActive } from "@/server/platform-admin/org-status";
import { eq } from "drizzle-orm";
import { scoped } from "@/lib/db/tenant";
import { logger } from "@/lib/log";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { graphRequest, MetaApiError, normalizeRecipient } from "@/lib/meta/client";
import { destinatarioMeta, type Destinatario } from "@/lib/meta/destinatario";
import { publish } from "@/server/events/bus";
import {
  getCredentialsByOrg,
  markReconnectRequired,
  type Credentials,
} from "@/server/whatsapp/credentials";
import { isWindowOpen } from "@/server/inbox/window";
import { IG_PREFIX } from "@/server/inbox/identity";
import {
  getInstagramCredentialsByOrg,
  markInstagramReconnectRequired,
  type InstagramCredentials,
} from "@/server/instagram/credentials";
import { sendInstagramText } from "@/server/instagram/send";
import { FB_PREFIX } from "@/server/inbox/identity";
import {
  getMessengerCredentialsByOrg,
  markMessengerReconnectRequired,
  type MessengerCredentials,
} from "@/server/messenger/credentials";
import { sendMessengerText } from "@/server/messenger/send";
import {
  capabilitiesFor,
  textFits,
  windowClosedMessage,
} from "@/server/channels/capabilities";
import { isChannelEnabled } from "@/server/channels/enabled";
import { serializeMessage } from "@/server/inbox/ingest";
import { numberAiRoute } from "@/server/mi-numero/ai";
import {
  saveMediaFile,
  uploadGraphMedia,
  validateOutgoing,
} from "@/server/whatsapp/media";
import { directNumber, unavailableText } from "@/lib/direct-send";
import { META_TEXT_MAX, splitForMeta } from "@/lib/message-length";
import {
  DirectSendFailure,
  directRouteFor,
  sendDirect,
  type DirectOutgoing,
} from "@/server/direct-connection/send";

const log = logger("send");

/** Error tipado del envío; `code` mapea a HTTP en la capa de API. */
export class SendError extends Error {
  code:
    | "sandbox_violation"
    | "not_connected"
    | "reconnect_required"
    | "window_closed"
    | "meta_error"
    | "meta_unavailable"
    | "upload_failed";
  /** 008: presente cuando el fallo ocurrió TRAS persistir el mensaje (failed). */
  messageId?: string;
  /**
   * 021: código de error de Meta (p. ej. 130429 = límite de envío), cuando el
   * fallo vino de Graph. Las campañas lo usan para pausar en vez de marcar
   * como fallido a un destinatario que solo tocó un límite de ritmo.
   */
  metaCode?: number | null;
  /**
   * Operación 1: se agotó el tiempo esperando a Meta (`MetaApiError.timedOut`).
   * El mensaje PUDO salir: no se reintenta (duplicaría). Va con el código
   * `meta_unavailable` para que las rutas respondan igual (503).
   */
  timedOut = false;

  constructor(code: SendError["code"], message: string, metaCode?: number | null) {
    super(message);
    this.name = "SendError";
    this.code = code;
    this.metaCode = metaCode ?? null;
  }
}

/** El texto que ve quien envía cuando Meta no respondió a tiempo. */
const META_TIMEOUT_MESSAGE =
  "Meta no respondió a tiempo: no se sabe si el mensaje salió. No se reintentó para no duplicarlo";

type SendResult = {
  messageId: string;
  /** Conexión directa (PR 3): el mensaje quedó «En cola» y sale solo a esta hora. */
  queuedUntil?: Date | null;
};

/**
 * Conexión directa (PR 3) — SOLO un envío de una persona desde la Bandeja
 * pide `allowDirect` (las rutas de texto y de archivos del chat). La
 * IA, las campañas, el cerebro externo, las bajas automáticas y las
 * plantillas no lo pasan: salen por Meta, siempre.
 */
export type SendOptions = { allowDirect?: boolean };

/**
 * PR 6 — Solo para `prepareSend`: un texto de la IA. Sale por el dispositivo
 * únicamente en una empresa SIN Meta con «IA por conexión directa» encendido
 * por la plataforma (lo decide `routeFor`); con Meta, la IA sale por Meta.
 */
type PrepareOptions = SendOptions & { aiDirect?: boolean };

type SendTarget = {
  conversation: typeof schema.conversation.$inferSelect;
  /** null cuando el destino no es WhatsApp (014). */
  credentials: Credentials | null;
  /** El destinatario en la forma que Meta espera: `to` o `recipient`. */
  destinatario: Destinatario;
  /** El identificador a secas, para lo que no arma un payload de Graph. */
  recipient: string;
  /** 014: presente solo en conversaciones de Instagram. */
  instagram?: InstagramCredentials;
  /** 017: presente solo en conversaciones de Messenger. */
  messenger?: MessengerCredentials;
  /** Conexión directa (PR 3): sale por el dispositivo vinculado, no por Graph. */
  direct?: true;
};

/**
 * Pre-flight común de todo envío por la conversación (008): existencia +
 * tenant, sandbox del Laboratorio (ASERCIÓN DURA, FR-031: jamás toca la API
 * real), ventana de 24 h, credenciales y destinatario.
 */
async function prepareSend(
  conversationId: string,
  organizationId: string,
  opts: PrepareOptions = {}
): Promise<SendTarget> {
  // Fase 3, PR 2: nada sale de una organización suspendida o dada de baja.
  await assertOrgActive(organizationId);
  const db = getDb();
  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const row = rows[0];
  if (!row || row.conversation.organizationId !== organizationId) {
    throw new SendError("meta_error", "Conversación no encontrada");
  }

  if (row.conversation.isTest) {
    throw new SendError(
      "sandbox_violation",
      "Conversación de prueba del Laboratorio: el envío real está prohibido"
    );
  }

  // 046: un chat de un «Mi número» jamás sale por aquí (ni por Meta ni por el
  // dispositivo de la empresa): solo su propio código lo contesta.
  if (row.conversation.directNumberId) {
    throw new SendError("meta_error", "Conversación no encontrada");
  }

  // 014: Instagram tiene su propio transporte, su propia ventana y NO tiene
  // plantillas. Se resuelve antes que las credenciales de WhatsApp para no
  // exigirle a una instancia de solo-Instagram un numero conectado.
  if (row.conversation.channel === "instagram") {
    // Una conversacion de un canal apagado puede existir (se apago despues de
    // recibirla): falla claro en vez de intentar un transporte que no aplica.
    if (!(await isChannelEnabled(organizationId, "instagram"))) {
      throw new SendError(
        "not_connected",
        "El canal de Instagram está desactivado en esta organización"
      );
    }
    const igCreds = await getInstagramCredentialsByOrg(organizationId);
    if (!igCreds) {
      throw new SendError(
        "not_connected",
        "No hay cuenta de Instagram conectada"
      );
    }
    if (igCreds.status === "reconnect_required") {
      throw new SendError(
        "reconnect_required",
        "El token de Instagram expiró: reconecta la cuenta en Configuración"
      );
    }
    const igRecipient = row.contact.waIdentity.startsWith(IG_PREFIX)
      ? row.contact.waIdentity.slice(IG_PREFIX.length)
      : row.contact.waIdentity;
    return {
      conversation: row.conversation,
      credentials: null,
      // Instagram no pasa por la Graph API de WhatsApp; el campo existe para
      // cumplir el tipo y su camino de envío no lo mira.
      destinatario: { to: igRecipient },
      recipient: igRecipient,
      instagram: igCreds,
    };
  }

  // 017: Messenger, mismo trato que Instagram: transporte propio, ventana
  // propia (con etiqueta fuera de ella) y sin plantillas.
  if (row.conversation.channel === "messenger") {
    if (!(await isChannelEnabled(organizationId, "messenger"))) {
      throw new SendError(
        "not_connected",
        "El canal de Messenger está desactivado en esta organización"
      );
    }
    const fbCreds = await getMessengerCredentialsByOrg(organizationId);
    if (!fbCreds) {
      throw new SendError(
        "not_connected",
        "No hay página de Facebook conectada"
      );
    }
    if (fbCreds.status === "reconnect_required") {
      throw new SendError(
        "reconnect_required",
        "El token de la página expiró: reconecta Messenger en Configuración"
      );
    }
    const fbRecipient = row.contact.waIdentity.startsWith(FB_PREFIX)
      ? row.contact.waIdentity.slice(FB_PREFIX.length)
      : row.contact.waIdentity;
    return {
      conversation: row.conversation,
      credentials: null,
      // Messenger tampoco pasa por la Graph API de WhatsApp.
      destinatario: { to: fbRecipient },
      recipient: fbRecipient,
      messenger: fbCreds,
    };
  }

  // Conexión directa (PR 3): un chat en Directa o Automática sale por el
  // dispositivo vinculado, sin ventana de 24 h. Sin `allowDirect`, sin el
  // módulo, sin dispositivo vinculado o en modo Meta: lo de siempre.
  const route = await directRouteFor(organizationId, { ...row.conversation, groupJid: row.contact.waGroupJid }, opts.allowDirect === true, new Date(), {
    ai: opts.aiDirect === true,
  });
  if (route.via === "unavailable") {
    throw new SendError("not_connected", unavailableText(route.reason));
  }
  if (route.via === "directa") {
    if (!row.contact.waGroupJid && !directNumber(row.contact.phone)) {
      throw new SendError(
        "meta_error",
        "Este contacto no tiene teléfono: no se puede enviar por conexión directa."
      );
    }
    return {
      conversation: row.conversation,
      credentials: null,
      // La vía directa arma su propio destino con el teléfono del contacto.
      destinatario: { to: "" },
      recipient: "",
      direct: true,
    };
  }

  // El nucleo no decide la politica: la consulta. WhatsApp exige plantilla
  // fuera de ventana; Instagram etiqueta y sigue; otro canal podria no tener
  // ventana en absoluto.
  const caps = capabilitiesFor(row.conversation.channel);
  if (
    caps.windowMs !== null &&
    caps.outsideWindow === "template" &&
    !isWindowOpen(row.conversation.lastInboundAt)
  ) {
    throw new SendError(
      "window_closed",
      windowClosedMessage(row.conversation.channel)
    );
  }

  // 0080: el chat responde por el número por el que le escribieron (el
  // principal si no consta o ya no existe).
  const credentials = await getCredentialsByOrg(organizationId, row.conversation.waPhoneNumberId);
  if (!credentials) {
    throw new SendError("not_connected", "No hay número de WhatsApp conectado");
  }
  if (credentials.status === "reconnect_required") {
    throw new SendError(
      "reconnect_required",
      "El token de WhatsApp expiró: reconecta el número en Configuración"
    );
  }

  /**
   * 003 — El destinatario, en el campo que Meta espera para cada forma.
   *
   * Un teléfono va en `to`; un BSUID va en `recipient` con
   * `recipient_type: "individual"`. Se mandaba el BSUID en `to` y Meta
   * respondía 131026, que en la bandeja se lee como si el número del cliente
   * no existiera.
   */
  const destinatario = destinatarioMeta(
    row.contact.phone ? normalizeRecipient(row.contact.phone) : null,
    row.contact.waUserId
  );
  const recipient = destinatario
    ? "to" in destinatario
      ? destinatario.to
      : destinatario.recipient
    : null;
  if (!destinatario || !recipient) {
    throw new SendError(
      "meta_error",
      "El contacto no tiene teléfono ni identidad de WhatsApp utilizable"
    );
  }

  return { conversation: row.conversation, credentials, destinatario, recipient };
}

type OutboundInput = {
  organizationId: string;
  conversationId: string;
  type: string;
  text: string | null;
  aiGenerated?: boolean;
  origin: "ai" | "operator";
  mediaAssetId?: string | null;
  /** 047 — la IA conectada de una persona lo mandó («enviado por IA»). */
  aiConnectionId?: string | null;
  aiSenderName?: string | null;
  /** 049 — mensaje automático sin IA (bienvenida / fuera de horario). */
  autoKind?: "welcome" | "away" | null;
};

type OutboundRow = typeof schema.message.$inferSelect;

/** Texto del mensaje que quedó sin confirmar: PUDO salir. */
export const UNCONFIRMED_SEND_TEXT =
  "Envío sin confirmar: Meta no respondió a tiempo, no se sabe si llegó. Revisa antes de reenviarlo";

/**
 * Auditoría DF-13 — El saliente se REGISTRA antes de llamar a Meta (estado
 * `pending`, aún sin `wa_message_id`). Antes se registraba después: si Meta
 * lo aceptaba y luego fallaba la base o el proceso, el cliente lo recibía y
 * el CRM no lo mostraba (o lo mostraba como fallido), y reenviarlo a mano lo
 * duplicaba. No se publica todavía: la bandeja lo ve al confirmarse.
 */
async function reserveOutbound(input: OutboundInput): Promise<OutboundRow> {
  const inserted = await getDb()
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId: null,
      direction: "out",
      type: input.type,
      text: input.text,
      status: "pending",
      aiGenerated: input.aiGenerated ?? false,
      origin: input.origin,
      mediaAssetId: input.mediaAssetId ?? null,
      aiConnectionId: input.aiConnectionId ?? null,
      aiSenderName: input.aiConnectionId ? (input.aiSenderName ?? null) : null,
      autoKind: input.autoKind ?? null,
    })
    .returning();
  return inserted[0]!;
}

/** Reintento corto de una escritura a la base (lo que falla es casi siempre momentáneo). */
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
  throw last;
}

/**
 * Meta lo aceptó: se guarda su ID y se publica. NUNCA lanza: el mensaje ya
 * salió, y un error aquí haría creer a quien llama que no salió (y lo
 * reenviaría). Si la base no responde, el mensaje queda en el hilo como
 * `pending` sin ID de Meta (visible, no perdido) y queda en el log.
 */
async function confirmOutbound(
  row: OutboundRow,
  waMessageId: string,
  status: "pending" | "sent",
  media: typeof schema.mediaAsset.$inferSelect | null = null
): Promise<string> {
  const db = getDb();
  const now = new Date();
  try {
    await withRetry(() =>
      db
        .update(schema.message)
        .set({ waMessageId, status })
        .where(scoped(schema.message.organizationId, row.organizationId, eq(schema.message.id, row.id)))
    );
  } catch (err) {
    log.error("Meta aceptó el mensaje pero no se pudo guardar su ID: queda en el hilo sin acuses", {
      org: row.organizationId,
      mensaje: row.id,
      err,
    });
  }
  try {
    await db
      .update(schema.conversation)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(scoped(schema.conversation.organizationId, row.organizationId, eq(schema.conversation.id, row.conversationId)));
  } catch (err) {
    log.warn("no se actualizó la fecha del chat tras un envío", { org: row.organizationId, err });
  }
  publish(row.organizationId, {
    type: "message.new",
    data: { conversationId: row.conversationId, message: serializeMessage({ ...row, waMessageId, status }, media) },
  });
  return row.id;
}

/**
 * Meta no lo aceptó. Si se SABE que no salió y no hay nada que conservar
 * (un texto), la reserva se borra, como antes (el texto sigue en la caja de
 * quien escribe). Si Meta no respondió a tiempo (PUDO salir) o hay un
 * archivo que conservar, queda en el hilo como fallido con su motivo, y el
 * error lleva su `messageId`. Nada lo reenvía solo.
 */
async function abandonOutbound(
  row: OutboundRow,
  err: unknown,
  opts: { keep: boolean; failure?: SendError; media?: typeof schema.mediaAsset.$inferSelect | null }
): Promise<never> {
  const db = getDb();
  const sendErr = opts.failure ?? (err instanceof SendError ? err : null);
  const unknown = sendErr?.timedOut === true;
  try {
    if (!unknown && !opts.keep) {
      await db.delete(schema.message).where(scoped(schema.message.organizationId, row.organizationId, eq(schema.message.id, row.id)));
    } else {
      const error = unknown ? UNCONFIRMED_SEND_TEXT : (sendErr?.message ?? "No se pudo enviar");
      const now = new Date();
      await db
        .update(schema.message)
        .set({ status: "failed", error, failedAt: now })
        .where(scoped(schema.message.organizationId, row.organizationId, eq(schema.message.id, row.id)));
      await db
        .update(schema.conversation)
        .set({ lastMessageAt: now, updatedAt: now })
        .where(scoped(schema.conversation.organizationId, row.organizationId, eq(schema.conversation.id, row.conversationId)));
      publish(row.organizationId, {
        type: "message.new",
        data: { conversationId: row.conversationId, message: serializeMessage({ ...row, status: "failed", error }, opts.media ?? null) },
      });
      if (sendErr) sendErr.messageId = row.id;
    }
  } catch (e) {
    log.error("no se pudo cerrar la reserva de un envío que Meta no aceptó", { org: row.organizationId, mensaje: row.id, err: e });
  }
  throw sendErr ?? err;
}

/** Envía un mensaje de texto libre por WhatsApp. */
export async function sendText(input: {
  conversationId: string;
  organizationId: string;
  text: string;
  aiGenerated?: boolean;
  /**
   * 047 — lo pidió la IA conectada de una persona (conector MCP). Sale como
   * la persona (origen `operator`) y por la MISMA vía que su chat en la
   * Bandeja (Meta, Directa o Automática), con los límites del dispositivo y
   * el tope diario del conector (decisión de Fer, 2026-10-28).
   */
  aiConnectionId?: string;
  /** El nombre de esa IA («Joe»), copiado en el mensaje; null = «Asistente». */
  aiSenderName?: string | null;
  /** 049 — es un mensaje automático (bienvenida / fuera de horario): no cuenta como respuesta de una persona. */
  autoKind?: "welcome" | "away";
} & SendOptions): Promise<SendResult> {
  // 046 (PR 8): la IA en un chat de cliente de un «Mi número» contesta por el
  // dispositivo de ESE número (con sus límites y su freno), nunca por Meta.
  if (input.aiGenerated) {
    const route = await numberAiRoute(input.organizationId, input.conversationId);
    if (route.kind === "blocked") throw new SendError("not_connected", route.message);
    if (route.kind === "number") {
      return viaDirect({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        type: "text",
        text: input.text,
        aiGenerated: true,
        number: route.scope,
      });
    }
  }
  const target = await prepareSend(input.conversationId, input.organizationId, {
    // El agente interno nunca: aunque alguien lo pidiera, un texto generado
    // sale por Meta. La IA conectada de una persona sí, como esa persona.
    allowDirect: input.allowDirect === true && !input.aiGenerated,
    aiDirect: input.aiGenerated === true,
  });
  if (target.direct) {
    return viaDirect({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      type: "text",
      text: input.text,
      aiGenerated: input.aiGenerated === true,
      aiConnectionId: input.aiConnectionId ?? null,
      aiSenderName: input.aiSenderName ?? null,
    });
  }
  const { credentials } = target;

  // Meta acepta 4,096 caracteres por texto: uno más largo sale en partes, en
  // orden (cada una espera a que Meta acepte la anterior).
  if (!target.instagram && !target.messenger && input.text.length > META_TEXT_MAX) {
    return sendTextInParts(input, target, credentials!);
  }

  const reserved = await reserveOutbound({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    type: "text",
    text: input.text,
    aiGenerated: input.aiGenerated,
    origin: input.aiGenerated ? "ai" : "operator",
    aiConnectionId: input.aiConnectionId ?? null,
    aiSenderName: input.aiSenderName ?? null,
    autoKind: input.autoKind ?? null,
  });
  let waMessageId: string;
  try {
    waMessageId = target.instagram
      ? await callInstagramSend(target, input.text)
      : target.messenger
        ? await callMessengerSend(target, input.text)
        : await callGraphSend(credentials!, {
            messaging_product: "whatsapp",
            ...target.destinatario,
            type: "text",
            text: { body: input.text },
          });
  } catch (err) {
    return abandonOutbound(reserved, err, { keep: false });
  }

  // Un canal sin acuses de entrega confirma al aceptar; uno con acuses
  // avanza despues por webhook. Sin esta distincion el mensaje se queda
  // con el reloj puesto para siempre.
  const status = capabilitiesFor(target.conversation.channel).deliveryReceipts ? "pending" : "sent";
  return { messageId: await confirmOutbound(reserved, waMessageId, status) };
}

/**
 * Un texto de WhatsApp por Meta de más de 4,096 caracteres: sale como varios
 * mensajes seguidos (`splitForMeta`), cada uno registrado antes de llamar a
 * Meta y confirmado antes de mandar el siguiente, así que el orden es el del
 * texto y nada se reintenta solo. Si una parte falla después de que otras ya
 * salieron, esa parte queda en el hilo como FALLIDA con todo lo que faltó por
 * enviar (para copiarlo, no para reenviar el texto completo y duplicar).
 */
async function sendTextInParts(
  input: { conversationId: string; organizationId: string; text: string; aiGenerated?: boolean; aiConnectionId?: string; aiSenderName?: string | null },
  target: SendTarget,
  credentials: Credentials
): Promise<SendResult> {
  const parts = splitForMeta(input.text);
  let lastId = "";
  for (let i = 0; i < parts.length; i++) {
    const reserved = await reserveOutbound({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      type: "text",
      text: parts[i]!,
      aiGenerated: input.aiGenerated,
      origin: input.aiGenerated ? "ai" : "operator",
      aiConnectionId: input.aiConnectionId ?? null,
      aiSenderName: input.aiSenderName ?? null,
    });
    let waMessageId: string;
    try {
      waMessageId = await callGraphSend(credentials, {
        messaging_product: "whatsapp",
        ...target.destinatario,
        type: "text",
        text: { body: parts[i]! },
      });
    } catch (err) {
      if (i === 0) return abandonOutbound(reserved, err, { keep: false });
      const rest = parts.slice(i).join("\n\n");
      const failure = new SendError(
        err instanceof SendError ? err.code : "meta_error",
        `Salieron ${i} de ${parts.length} partes del mensaje. Lo que faltó quedó en el chat como no enviado: ` +
          `cópialo de ahí (no reenvíes el texto completo). ${err instanceof Error ? err.message : ""}`.trim()
      );
      if (err instanceof SendError) failure.timedOut = err.timedOut;
      try {
        await getDb()
          .update(schema.message)
          .set({ text: rest })
          .where(scoped(schema.message.organizationId, reserved.organizationId, eq(schema.message.id, reserved.id)));
      } catch (e) {
        log.warn("no se guardó el resto de un mensaje en partes", { org: input.organizationId, err: e });
      }
      return abandonOutbound({ ...reserved, text: rest }, err, { keep: true, failure });
    }
    lastId = await confirmOutbound(reserved, waMessageId, "pending");
  }
  return { messageId: lastId };
}

/**
 * 008 — Envía un adjunto de archivo (imagen/video/audio/documento).
 * El archivo queda ANTES en el volumen local (fuente durable de la preview);
 * si Graph falla tras eso, el mensaje se persiste `failed` (visible en el
 * hilo, nunca se pierde en silencio) y el SendError lleva `messageId`.
 */
export async function sendMediaMessage(input: {
  conversationId: string;
  organizationId: string;
  file: { data: Buffer; mimeType: string; fileName?: string };
  caption?: string;
  /** 047 — lo pidió la IA conectada de una persona (se firma como en el texto). */
  aiConnectionId?: string;
  aiSenderName?: string | null;
} & SendOptions): Promise<SendResult> {
  // Validación previa (FR-007): tipo y tamaño antes de tocar disco o red.
  const kind = validateOutgoing(input.file.mimeType, input.file.data.byteLength, input.file.fileName);

  const target = await prepareSend(input.conversationId, input.organizationId, {
    allowDirect: input.allowDirect,
  });
  const { credentials } = target;
  const sendCaps = capabilitiesFor(target.conversation.channel);
  if (!sendCaps.outboundMedia) {
    throw new SendError(
      "meta_error",
      `Todavía no se pueden enviar adjuntos por ${sendCaps.label}; manda el texto`
    );
  }

  const db = getDb();
  const assetId = newId("mediaAsset");
  const storagePath = await saveMediaFile(
    input.organizationId,
    assetId,
    input.file.data
  );
  const assetRows = await db
    .insert(schema.mediaAsset)
    .values({
      id: assetId,
      organizationId: input.organizationId,
      kind,
      mimeType: input.file.mimeType,
      fileName: input.file.fileName ?? null,
      fileSize: input.file.data.byteLength,
      caption: input.caption ?? null,
      storagePath,
      fetchStatus: "available",
    })
    .returning();
  const asset = assetRows[0]!;

  // Conexión directa (PR 3): el archivo ya está en disco; la vía directa lo
  // lee de ahí (también si espera en la fila). Si falla, queda `failed`.
  if (target.direct) {
    return viaDirect({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      type: kind,
      text: null,
      mediaAsset: asset,
      aiConnectionId: input.aiConnectionId ?? null,
      aiSenderName: input.aiSenderName ?? null,
    });
  }

  const reserved = await reserveOutbound({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    type: kind,
    text: null,
    origin: "operator",
    mediaAssetId: assetId,
    aiConnectionId: input.aiConnectionId ?? null,
    aiSenderName: input.aiSenderName ?? null,
  });
  let waMessageId: string;
  try {
    const waMediaId = await uploadGraphMedia(credentials!, input.file);
    await db
      .update(schema.mediaAsset)
      .set({ waMediaId, updatedAt: new Date() })
      .where(eq(schema.mediaAsset.id, assetId));

    const mediaPayload: Record<string, unknown> = { id: waMediaId };
    if (input.caption && kind !== "audio") mediaPayload.caption = input.caption;
    if (kind === "document" && input.file.fileName) {
      mediaPayload.filename = input.file.fileName;
    }
    waMessageId = await callGraphSend(credentials!, {
      messaging_product: "whatsapp",
      ...target.destinatario,
      type: kind,
      [kind]: mediaPayload,
    });
  } catch (err) {
    let sendErr: SendError;
    if (err instanceof SendError) {
      sendErr = err;
    } else if (err instanceof MetaApiError && err.isAuthError) {
      // Mismo criterio que el texto: SOLO 401/código 190 (fix 2026-08-04).
      await markReconnectRequired(input.organizationId, credentials!.phoneNumberId);
      sendErr = new SendError(
        "reconnect_required",
        "El token de WhatsApp expiró: reconecta el número en Configuración"
      );
    } else {
      sendErr = new SendError(
        "upload_failed",
        "No se pudo subir el adjunto a WhatsApp"
      );
    }
    // El contenido NO se pierde: mensaje failed con el asset ya en disco.
    return abandonOutbound(reserved, err, { keep: true, failure: sendErr, media: asset });
  }
  // DF-13: lo que pase después de que Meta lo aceptó ya no lo marca fallido.
  return { messageId: await confirmOutbound(reserved, waMessageId, "pending", asset) };
}

type LocationInput = {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
};

type ContactInput = { name: string; phone: string };

/** 008 — Envía una ubicación o contactos (payload estructurado, sin archivo). */
export async function sendStructured(
  input: {
    conversationId: string;
    organizationId: string;
  } & (
    | { kind: "location"; location: LocationInput }
    | { kind: "contacts"; contacts: ContactInput[] }
  )
): Promise<SendResult> {
  const target = await prepareSend(
    input.conversationId,
    input.organizationId
  );
  // Ubicaciones y contactos son mensajes de WhatsApp: en los demás canales no
  // hay credenciales de WhatsApp que usar y Graph los rechazaría.
  if (!target.credentials) {
    throw new SendError(
      "meta_error",
      "Este canal no admite ubicaciones ni contactos; manda el texto"
    );
  }

  const payload =
    input.kind === "location"
      ? { type: "location", location: input.location }
      : {
          type: "contacts",
          contacts: input.contacts.map((c) => ({
            name: { formatted_name: c.name, first_name: c.name },
            phones: [{ phone: c.phone, type: "CELL" }],
          })),
        };

  const db = getDb();
  const assetRows = await db
    .insert(schema.mediaAsset)
    .values({
      id: newId("mediaAsset"),
      organizationId: input.organizationId,
      kind: input.kind,
      payload: input.kind === "location" ? input.location : input.contacts,
      fetchStatus: "available",
    })
    .returning();
  const asset = assetRows[0]!;

  const reserved = await reserveOutbound({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    type: input.kind,
    text: null,
    origin: "operator",
    mediaAssetId: asset.id,
  });
  let waMessageId: string;
  try {
    waMessageId = await callGraphSend(target.credentials, {
      messaging_product: "whatsapp",
      ...target.destinatario,
      ...payload,
    });
  } catch (err) {
    return abandonOutbound(reserved, err, { keep: false, media: asset });
  }
  return { messageId: await confirmOutbound(reserved, waMessageId, "pending", asset) };
}

/** Conexión directa (PR 3): envía por el dispositivo y traduce su falla a `SendError`. */
async function viaDirect(input: DirectOutgoing): Promise<SendResult> {
  try {
    return await sendDirect(input);
  } catch (err) {
    if (err instanceof DirectSendFailure) {
      const sendErr = new SendError(err.code, err.message);
      sendErr.timedOut = err.timedOut;
      sendErr.messageId = err.messageId;
      throw sendErr;
    }
    throw err;
  }
}

/** Llama a Graph /messages y traduce errores de Meta a SendError. */
export async function callGraphSend(
  credentials: Credentials,
  payload: unknown
): Promise<string> {
  try {
    const res = await graphRequest<{ messages?: { id: string }[] }>(
      `${credentials.phoneNumberId}/messages`,
      { method: "POST", token: credentials.token, body: payload }
    );
    const id = res.messages?.[0]?.id;
    if (!id) throw new SendError("meta_error", "Meta no devolvió ID de mensaje");
    return id;
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markReconnectRequired(credentials.organizationId, credentials.phoneNumberId);
        throw new SendError(
          "reconnect_required",
          "El token de WhatsApp expiró: reconecta el número en Configuración"
        );
      }
      if (err.timedOut) {
        const timeout = new SendError("meta_unavailable", META_TIMEOUT_MESSAGE, err.code);
        timeout.timedOut = true;
        throw timeout;
      }
      if (err.status === 0 || err.status >= 500) {
        throw new SendError("meta_unavailable", "Meta no está disponible ahora", err.code);
      }
      throw new SendError("meta_error", err.message, err.code);
    }
    throw err;
  }
}


/**
 * 014 — Envío por el canal de Instagram. Traduce los fallos al mismo
 * vocabulario de SendError que ya usa WhatsApp, para que la bandeja no tenga
 * que aprender un idioma por plataforma.
 */
async function callInstagramSend(
  target: SendTarget,
  text: string
): Promise<string> {
  const creds = target.instagram!;

  const caps = capabilitiesFor("instagram");
  if (!textFits("instagram", text)) {
    throw new SendError(
      "meta_error",
      `${caps.label} no acepta mensajes de más de ${caps.maxTextBytes} bytes: acorta el texto`
    );
  }

  // Instagram no tiene plantillas: fuera de la ventana de 24 h la única vía
  // es la etiqueta de agente humano (hasta 7 días).
  const humanAgentTag = !isWindowOpen(target.conversation.lastInboundAt);

  try {
    const res = await sendInstagramText({
      credentials: creds,
      recipient: target.recipient,
      threadRef: target.conversation.channelThreadRef,
      text,
      humanAgentTag,
    });
    return res.platformMessageId;
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markInstagramReconnectRequired(creds.organizationId);
        throw new SendError(
          "reconnect_required",
          "El token de Instagram expiró o fue revocado: reconecta la cuenta"
        );
      }
      if (err.status === 0 || err.status >= 500) {
        throw new SendError(
          "meta_unavailable",
          "Instagram no está disponible en este momento; intenta de nuevo"
        );
      }
      throw new SendError("meta_error", err.message);
    }
    throw err;
  }
}

/**
 * 017 — Envío por el canal de Messenger. Mismo vocabulario de SendError que
 * WhatsApp e Instagram: la bandeja no aprende un idioma por plataforma.
 */
async function callMessengerSend(
  target: SendTarget,
  text: string
): Promise<string> {
  const creds = target.messenger!;

  const caps = capabilitiesFor("messenger");
  if (!textFits("messenger", text)) {
    throw new SendError(
      "meta_error",
      `${caps.label} no acepta mensajes de más de ${caps.maxTextBytes} bytes: acorta el texto`
    );
  }

  // Messenger no tiene plantillas: fuera de la ventana de 24 h la única vía
  // es la etiqueta de agente humano (hasta 7 días).
  const humanAgentTag = !isWindowOpen(target.conversation.lastInboundAt);

  try {
    const res = await sendMessengerText({
      credentials: creds,
      recipient: target.recipient,
      // Zernio responde dentro de SU conversación, no al PSID: sin esta
      // referencia el envío no tiene a dónde ir.
      threadRef: target.conversation.channelThreadRef,
      text,
      humanAgentTag,
    });
    return res.platformMessageId;
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markMessengerReconnectRequired(creds.organizationId);
        throw new SendError(
          "reconnect_required",
          "El token de la página expiró o fue revocado: reconecta Messenger"
        );
      }
      if (err.status === 0 || err.status >= 500) {
        throw new SendError(
          "meta_unavailable",
          "Messenger no está disponible en este momento; intenta de nuevo"
        );
      }
      throw new SendError("meta_error", err.message);
    }
    throw err;
  }
}
