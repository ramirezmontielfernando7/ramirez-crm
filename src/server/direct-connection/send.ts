import { eq, gt, inArray, isNotNull, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { getDb, getSystemDb, schema, withTenant } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { ConnectionMode } from "@/lib/direct-connection";
import {
  classifyFailure,
  DIRECT_TIMEOUT_TEXT,
  directNumber,
  failureText,
  isPaused,
  MAX_QUEUE_MS,
  nextSlot,
  routeFor,
  STUCK_SEND_MS,
  typingDelayMs,
  unavailableText,
  type RecentSend,
  type Route,
} from "@/lib/direct-send";
import {
  EvolutionApiError,
  sendMediaFile,
  sendPresence,
  sendTextMessage,
  type DirectMedia,
  type EvolutionTarget,
} from "@/lib/evolution/client";
import { logger } from "@/lib/log";
import { runWithOrganization } from "@/lib/request-context";
import { orgHasWhatsAppConnection } from "@/server/credentials";
import { getDirectConnection, openDirectTarget } from "@/server/credentials/direct-instance";
import { publish } from "@/server/events/bus";
import { serializeMessage } from "@/server/inbox/ingest";
import { isWindowOpen } from "@/server/inbox/window";
import { getOrgModules, orgHasConexionDirecta } from "@/server/modules";
import { isOrgActive } from "@/server/platform-admin/org-status";
import { beginTask, isShuttingDown, onShutdown } from "@/server/shutdown";
import { readMediaFile } from "@/server/whatsapp/media";
import { numberMessageId } from "@/lib/direct-inbound";
import { recordDirectFailure } from "./brake";
import { getDirectSettings } from "./settings";

/**
 * Conexión directa (PR 3) — Envío por el dispositivo vinculado.
 *
 * Solo lo usa `src/server/inbox/send.ts` cuando una PERSONA envía desde la
 * Bandeja (`allowDirect`) en un chat en modo Directa o Automática. La IA, las
 * campañas, el cerebro externo y las bajas automáticas nunca pasan
 * `allowDirect`, así que nunca llegan aquí (guardarraíl
 * `tests/unit/conexion-directa-envio.test.ts`). Las plantillas salen siempre
 * por Meta (`sendTemplate` no conoce esta vía).
 *
 * Cada mensaje:
 * 1. Bajo el candado de la organización se calcula su hora de salida con
 *    los límites (`nextSlot`) y se guarda (`transport = 'directa'`). Si le
 *    toca después, queda «En cola» (`queued_until`) y sale solo con un timer;
 *    al arrancar se retoma la fila (`resumeDirectQueue`).
 * 2. «escribiendo…» de 1 a 3 s y luego el mensaje.
 * 3. Bien: `sent` + el ID del dispositivo en `alt_message_id`. El eco de
 *    Meta (`smb_message_echoes`) de este mensaje llega con otro
 *    `wa_message_id` y se une a esta fila por ese ID (PR 4,
 *    `src/server/direct-connection/echo.ts`): no se ve dos veces.
 * 4. Mal: `failed` con el motivo en palabras discretas; si fue el
 *    dispositivo (no el número del contacto), cuenta para el freno de
 *    emergencia (`recordDirectFailure`).
 *
 * Mi número (046, PR 5): un chat de un «Mi número» (`direct_number_id`) sale
 * por el dispositivo de ESE número (lo pide solo `src/server/mi-numero/send.ts`).
 * Sus límites, su fila y su freno son solo suyos (no gastan los de la
 * empresa) y sus avisos en vivo van solo a su dueño (`number.*`).
 */

const log = logger("direct-connection");

/** Falla del envío directo, en el vocabulario de `SendError` (para no tocar las rutas). */
export class DirectSendFailure extends Error {
  code: "not_connected" | "meta_error" | "meta_unavailable";
  timedOut: boolean;
  messageId?: string;
  constructor(code: DirectSendFailure["code"], message: string, opts: { timedOut?: boolean; messageId?: string } = {}) {
    super(message);
    this.name = "DirectSendFailure";
    this.code = code;
    this.timedOut = opts.timedOut ?? false;
    this.messageId = opts.messageId;
  }
}

export { DIRECT_TIMEOUT_TEXT };

/* ───────── ¿Por dónde sale? ───────── */

/**
 * La ruta de un envío. Sin `allowDirect` (ni IA), o fuera de WhatsApp,
 * responde Meta SIN tocar la BD (las campañas no pagan ni una consulta). Si
 * algo falla al leer, Meta: lo de siempre.
 *
 * PR 6: `ai` = un texto de la IA. Solo cuenta en una empresa sin Meta con
 * «IA por conexión directa» encendido; con Meta, la IA sale por Meta.
 */
export async function directRouteFor(
  organizationId: string,
  conversation: { channel: string; connectionMode: string | null; lastInboundAt: Date | null },
  allowDirect: boolean,
  now = new Date(),
  opts: { ai?: boolean } = {}
): Promise<Route> {
  const ai = opts.ai === true;
  if ((!allowDirect && !ai) || conversation.channel !== "whatsapp") return { via: "meta" };
  try {
    if (!(await orgHasConexionDirecta(organizationId))) return { via: "meta" };
    const [settings, connection, hasMeta] = await Promise.all([
      getDirectSettings(organizationId),
      getDirectConnection(organizationId),
      orgHasWhatsAppConnection(organizationId),
    ]);
    return routeFor({
      moduleOn: true,
      allowDirect,
      ai,
      hasMeta,
      channel: conversation.channel,
      chatMode: (conversation.connectionMode as ConnectionMode | null) ?? null,
      settings,
      connection,
      windowOpen: isWindowOpen(conversation.lastInboundAt, now),
      now,
    });
  } catch (err) {
    log.error("no se pudo decidir la vía del envío; sale por Meta", { org: organizationId, err });
    return { via: "meta" };
  }
}

/* ───────── Encolar y enviar ───────── */

export type DirectOutgoing = {
  organizationId: string;
  conversationId: string;
  type: "text" | "image" | "video" | "audio" | "document";
  text: string | null;
  mediaAsset?: typeof schema.mediaAsset.$inferSelect | null;
  /** PR 6: un texto de la IA en una empresa sin Meta (se ve como de la IA en el hilo). */
  aiGenerated?: boolean;
  /** 046: el chat es de este «Mi número»; `audience` = quién se entera (su dueño). */
  number?: NumberScope;
};

/** 046 — Un chat de un «Mi número»: su id y quién se entera de lo que pasa en él. */
export type NumberScope = { directNumberId: string; audience: string[] };

export type DirectResult = { messageId: string; queuedUntil: Date | null };

/**
 * Los envíos por la directa de la última hora, con su hora de salida (la
 * agendada si está en fila). 046: los de un «Mi número» cuentan solo para
 * ese número; los de la empresa, solo para la empresa.
 */
async function recentDirectSends(organizationId: string, now: Date, directNumberId: string | null): Promise<RecentSend[]> {
  const at = sql<Date>`coalesce(${schema.message.queuedUntil}, ${schema.message.sentAt}, ${schema.message.createdAt})`;
  const rows = await getDb()
    .select({ conversationId: schema.message.conversationId, at })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.transport, "directa"),
        eq(schema.message.direction, "out"),
        ne(schema.message.status, "failed"),
        sql`${at} > ${new Date(now.getTime() - 60 * 60_000).toISOString()}::timestamp`,
        directNumberId
          ? sql`${schema.message.conversationId} in (select c_num.id from conversation c_num where c_num.organization_id = ${organizationId} and c_num.direct_number_id = ${directNumberId})`
          : sql`not exists (select 1 from conversation c_num where c_num.id = ${schema.message.conversationId} and c_num.direct_number_id is not null)`
      )
    );
  return rows.map((r) => ({ conversationId: r.conversationId, at: new Date(r.at) }));
}

/**
 * Envía (o pone en fila) un mensaje por la directa. Si sale ya y falla, lanza
 * `DirectSendFailure`: el texto NO se queda en el hilo (igual que por Meta:
 * el compositor lo devuelve), el archivo sí, como `failed`. Uno que se agotó
 * esperando respuesta se queda `failed` con «no se sabe si salió».
 */
export async function sendDirect(input: DirectOutgoing): Promise<DirectResult> {
  const { organizationId, conversationId } = input;
  const settings = await getDirectSettings(organizationId);
  const now = new Date();
  const scope = input.number ?? null;
  const lockKey = scope ? `direct_send:${organizationId}:${scope.directNumberId}` : `direct_send:${organizationId}`;

  const { message, queuedUntil } = await withTenant(organizationId, async (tx) => {
    // Un envío a la vez por organización mientras se elige la hora: dos
    // personas escribiendo al mismo tiempo no pueden tomar el mismo hueco.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
    const recent = await recentDirectSends(organizationId, now, scope?.directNumberId ?? null);
    const slot = nextSlot(now, conversationId, recent, {
      enabled: settings.limitsEnabled,
      minIntervalSeconds: settings.minIntervalSeconds,
      perChatPerMinute: settings.perChatPerMinute,
      perHour: settings.perHour,
    });
    if (slot.getTime() - now.getTime() > MAX_QUEUE_MS) {
      throw new DirectSendFailure(
        "meta_error",
        "Ya hay muchos mensajes en cola por conexión directa: espera a que salgan."
      );
    }
    // Menos de un segundo de espera no vale una fila: sale ya.
    const queued = slot.getTime() - now.getTime() >= 1000 ? slot : null;
    const [row] = await tx
      .insert(schema.message)
      .values({
        id: newId("message"),
        organizationId,
        conversationId,
        waMessageId: null,
        direction: "out",
        type: input.type,
        text: input.text,
        status: "pending",
        origin: input.aiGenerated ? "ai" : "operator",
        aiGenerated: input.aiGenerated === true,
        mediaAssetId: input.mediaAsset?.id ?? null,
        transport: "directa",
        queuedUntil: queued,
        // La hora de salida cuenta para los límites desde ya.
        sentAt: queued ? null : now,
      })
      .returning();
    await tx
      .update(schema.conversation)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)));
    return { message: row!, queuedUntil: queued };
  });

  if (queuedUntil) {
    publishNew(message, input.mediaAsset ?? null, scope);
    scheduleDispatch(organizationId, message.id, queuedUntil);
    return { messageId: message.id, queuedUntil };
  }

  const outcome = await deliver(organizationId, message.id);
  if (outcome.ok) {
    publishNew({ ...message, status: "sent", altMessageId: outcome.altId }, input.mediaAsset ?? null, scope);
    return { messageId: message.id, queuedUntil: null };
  }
  // Texto que no salió (y se sabe que no salió): fuera del hilo, como por Meta.
  if (input.type === "text" && !outcome.timedOut) {
    await getDb().delete(schema.message).where(scoped(schema.message.organizationId, organizationId, eq(schema.message.id, message.id)));
    throw new DirectSendFailure(outcome.code, outcome.error, { timedOut: false });
  }
  publishNew({ ...message, status: "failed", error: outcome.error }, input.mediaAsset ?? null, scope);
  throw new DirectSendFailure(outcome.code, outcome.error, { timedOut: outcome.timedOut, messageId: message.id });
}

function publishNew(m: typeof schema.message.$inferSelect, media: typeof schema.mediaAsset.$inferSelect | null, scope: NumberScope | null) {
  const data = { conversationId: m.conversationId, message: serializeMessage(m, media) };
  if (scope) {
    // 046: lo de un «Mi número» solo lo ve su dueño.
    publish(m.organizationId, { type: "number.message", data, audience: scope.audience });
    publish(m.organizationId, { type: "number.conversation", data: { conversationId: m.conversationId }, audience: scope.audience });
    return;
  }
  publish(m.organizationId, { type: "message.new", data });
}

/** El cambio de estado de un mensaje: a todos los que ven el chat, o (046) solo al dueño del número. */
function publishStatus(
  organizationId: string,
  scope: NumberScope | null,
  data: { conversationId: string; messageId: string; status: "sent" | "failed"; error?: string },
  message?: typeof schema.message.$inferSelect,
  media?: typeof schema.mediaAsset.$inferSelect | null
) {
  if (scope) {
    if (message) publish(organizationId, { type: "number.message", data: { conversationId: data.conversationId, message: serializeMessage(message, media ?? null) }, audience: scope.audience });
    publish(organizationId, { type: "number.conversation", data: { conversationId: data.conversationId }, audience: scope.audience });
    return;
  }
  publish(organizationId, { type: "message.status", data });
}

/** 046 — De quién es el «Mi número» de un chat (para sus avisos), o null si es de la empresa. */
async function numberScopeOf(organizationId: string, directNumberId: string | null): Promise<NumberScope | null> {
  if (!directNumberId) return null;
  const [n] = await getDb()
    .select({ userId: schema.directNumber.userId, revokedAt: schema.directNumber.revokedAt })
    .from(schema.directNumber)
    .where(scoped(schema.directNumber.organizationId, organizationId, eq(schema.directNumber.id, directNumberId)))
    .limit(1);
  return { directNumberId, audience: n ? [n.userId] : [] };
}

type Outcome =
  | { ok: true; altId: string }
  | { ok: false; code: DirectSendFailure["code"]; error: string; timedOut: boolean };

/**
 * Manda UN mensaje ya guardado (pendiente, sin ID del dispositivo) y deja su
 * estado final en la BD. Vuelve a revisar todo justo antes de enviar: la
 * organización, el módulo, el dispositivo y el freno pueden haber cambiado
 * mientras esperaba en la fila.
 */
async function deliver(organizationId: string, messageId: string): Promise<Outcome> {
  const task = beginTask(`direct-send:${messageId}`);
  let scope: NumberScope | null = null;
  try {
    const db = getDb();
    const [row] = await db
      .select({ message: schema.message, conversation: schema.conversation, contact: schema.contact, media: schema.mediaAsset })
      .from(schema.message)
      .innerJoin(schema.conversation, eq(schema.conversation.id, schema.message.conversationId))
      .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
      .leftJoin(schema.mediaAsset, eq(schema.mediaAsset.id, schema.message.mediaAssetId))
      .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.id, messageId)))
      .limit(1);
    if (!row) return { ok: false, code: "meta_error", error: "El mensaje ya no existe", timedOut: false };
    const numberId = row.conversation.directNumberId;
    scope = await numberScopeOf(organizationId, numberId);

    const fail = async (code: DirectSendFailure["code"], error: string, timedOut = false): Promise<Outcome> => {
      await markFailed(organizationId, row.message.conversationId, messageId, error, scope);
      return { ok: false, code, error, timedOut };
    };

    // Guardarraíl del Laboratorio: un chat de prueba jamás toca nada real.
    if (row.conversation.isTest) return fail("meta_error", "Conversación de prueba del Laboratorio: el envío real está prohibido");
    if (!(await isOrgActive(organizationId))) return fail("not_connected", "La organización no está activa");
    if (!(await orgHasConexionDirecta(organizationId))) return fail("not_connected", unavailableText("module_off"));
    if (numberId) {
      // 046: el complemento y el número tienen que seguir vivos al salir.
      if (!(await getOrgModules(organizationId)).miNumero) return fail("not_connected", unavailableText("module_off"));
      const [live] = await getDb()
        .select({ id: schema.directNumber.id })
        .from(schema.directNumber)
        .where(scoped(schema.directNumber.organizationId, organizationId, eq(schema.directNumber.id, numberId), isNull(schema.directNumber.revokedAt)))
        .limit(1);
      if (!live) return fail("not_connected", unavailableText("disconnected"));
    }
    const connection = await getDirectConnection(organizationId, numberId);
    if (!connection || connection.status === "pending") return fail("not_connected", unavailableText("disconnected"));
    if (isPaused(connection, new Date())) return fail("not_connected", unavailableText("paused"));
    if (connection.status !== "connected") return fail("not_connected", unavailableText("disconnected"));

    const number = directNumber(row.contact.phone);
    if (!number) return fail("meta_error", "Este contacto no tiene teléfono: no se puede enviar por conexión directa.");

    const opened = await openDirectTarget(organizationId, numberId);
    if (!opened.ok) {
      log.error("no se pudo abrir la llave de la conexión directa", { org: organizationId, motivo: opened.error });
      return fail("not_connected", unavailableText("disconnected"));
    }

    let media: DirectMedia | null = null;
    if (row.message.type !== "text") {
      if (!row.media) return fail("meta_error", "El archivo de este mensaje ya no existe");
      try {
        media = {
          kind: row.message.type as DirectMedia["kind"],
          mimeType: row.media.mimeType ?? "application/octet-stream",
          fileName: row.media.fileName,
          caption: row.media.caption,
          data: await readMediaFile(organizationId, row.media.id),
        };
      } catch (err) {
        log.error("no se pudo leer el archivo para la conexión directa", { org: organizationId, err });
        return fail("meta_error", "No se pudo leer el archivo para enviarlo");
      }
    }

    try {
      const altId = await send(opened.target, number, row.message.text, media);
      const [sent] = await getDb()
        .update(schema.message)
        .set({ status: "sent", altMessageId: altId, sentAt: row.message.sentAt ?? new Date(), error: null })
        .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.id, messageId)))
        .returning();
      if (numberId) await dropNumberEcho(organizationId, numberId, altId, messageId);
      publishStatus(organizationId, scope, { conversationId: row.message.conversationId, messageId, status: "sent" }, sent, row.media);
      return { ok: true, altId };
    } catch (err) {
      if (!(err instanceof EvolutionApiError)) throw err;
      const kind = classifyFailure(err);
      log.warn("el dispositivo vinculado rechazó un envío", { org: organizationId, msg: messageId, status: err.status, tipo: kind });
      if (kind === "ban" || kind === "connection") await recordDirectFailure(organizationId, kind, new Date(), numberId);
      if (err.timedOut) return fail("meta_unavailable", DIRECT_TIMEOUT_TEXT, true);
      return fail(kind === "connection" || kind === "ban" ? "meta_unavailable" : "meta_error", failureText(kind));
    }
  } catch (err) {
    log.error("falló el envío por conexión directa", { org: organizationId, msg: messageId, err });
    await markFailed(organizationId, null, messageId, failureText("connection"), scope).catch(() => undefined);
    return { ok: false, code: "meta_unavailable", error: failureText("connection"), timedOut: false };
  } finally {
    task.end();
  }
}

/** «escribiendo…» (si falla, se manda igual) y luego el mensaje. */
async function send(target: EvolutionTarget, number: string, text: string | null, media: DirectMedia | null): Promise<string> {
  try {
    await sendPresence(target, number, typingDelayMs());
  } catch (err) {
    // Un servidor caído también falla aquí; el envío de abajo lo confirma o lo cuenta.
    if (err instanceof EvolutionApiError && err.status === 0 && !err.timedOut) throw err;
  }
  if (media) return sendMediaFile(target, number, media);
  return sendTextMessage(target, number, text ?? "");
}

/**
 * 046 — El dispositivo también avisa lo que acaba de salir (`messages.upsert`
 * con `fromMe`). Si ese aviso llegó antes de que este envío guardara su ID,
 * ya se registró como un mensaje aparte: se quita para no verlo dos veces.
 */
async function dropNumberEcho(organizationId: string, directNumberId: string, altId: string, keepId: string): Promise<void> {
  await getDb()
    .delete(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.waMessageId, numberMessageId(directNumberId, altId)),
        ne(schema.message.id, keepId)
      )
    )
    .catch((err: unknown) => log.warn("no se pudo quitar el aviso repetido de un envío", { org: organizationId, err }));
}

async function markFailed(
  organizationId: string,
  conversationId: string | null,
  messageId: string,
  error: string,
  scope: NumberScope | null = null
): Promise<void> {
  const [row] = await getDb()
    .update(schema.message)
    .set({ status: "failed", error, failedAt: new Date(), queuedUntil: null })
    .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.id, messageId), eq(schema.message.status, "pending")))
    .returning({ conversationId: schema.message.conversationId });
  const conv = row?.conversationId ?? conversationId;
  if (row && conv) publishStatus(organizationId, scope, { conversationId: conv, messageId, status: "failed", error });
}

/* ───────── La fila: timers, arranque y apagado ───────── */

type QueueState = { timers: Map<string, ReturnType<typeof setTimeout>>; inflight: Set<Promise<unknown>> };
const globalForQueue = globalThis as unknown as { __voceroDirectQueue?: QueueState };

function queue(): QueueState {
  if (!globalForQueue.__voceroDirectQueue) {
    globalForQueue.__voceroDirectQueue = { timers: new Map(), inflight: new Set() };
    onShutdown("direct-queue", {
      // Lo que sigue en fila se queda en la BD y se retoma al arrancar.
      stop: () => {
        for (const t of queue().timers.values()) clearTimeout(t);
        queue().timers.clear();
      },
      drain: () => Promise.allSettled([...queue().inflight]),
    });
  }
  return globalForQueue.__voceroDirectQueue;
}

/** Agenda la salida de un mensaje en fila. Mismo mensaje = un solo timer. */
export function scheduleDispatch(organizationId: string, messageId: string, at: Date): void {
  const q = queue();
  if (q.timers.has(messageId) || isShuttingDown()) return;
  const delay = Math.max(0, at.getTime() - Date.now());
  const timer = setTimeout(() => {
    q.timers.delete(messageId);
    const p = runWithOrganization(organizationId, () => dispatchQueued(organizationId, messageId))
      .catch((err: unknown) => log.error("falló la salida de un mensaje en cola", { org: organizationId, msg: messageId, err }))
      .finally(() => q.inflight.delete(p));
    q.inflight.add(p);
  }, delay);
  timer.unref?.();
  q.timers.set(messageId, timer);
}

/**
 * Le tocó salir a un mensaje en fila. El reclamo (quitar `queued_until` solo
 * si sigue ahí) es atómico: si dos timers o dos réplicas lo intentan, sale una
 * vez.
 */
export async function dispatchQueued(organizationId: string, messageId: string, now = new Date()): Promise<void> {
  const [claimed] = await getDb()
    .update(schema.message)
    .set({ queuedUntil: null, sentAt: now })
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.id, messageId),
        eq(schema.message.status, "pending"),
        eq(schema.message.transport, "directa"),
        isNotNull(schema.message.queuedUntil),
        lte(schema.message.queuedUntil, new Date(now.getTime() + 1000))
      )
    )
    .returning({ id: schema.message.id });
  if (!claimed) return;
  await deliver(organizationId, messageId);
}

/**
 * Al arrancar: retoma la fila de cada organización con conexión directa, y
 * da por fallido (SIN reenviar) lo que se quedó a medias por un reinicio.
 * Nunca tumba el arranque.
 */
export async function resumeDirectQueue(now = new Date()): Promise<void> {
  let orgs: string[];
  try {
    const rows = await getSystemDb()
      .selectDistinct({ organizationId: schema.directConnection.organizationId })
      .from(schema.directConnection);
    orgs = rows.map((r) => r.organizationId);
  } catch (err) {
    log.error("no se pudo retomar la fila de la conexión directa", { err });
    return;
  }
  for (const organizationId of orgs) {
    try {
      await runWithOrganization(organizationId, () => resumeOrganization(organizationId, now));
    } catch (err) {
      log.error("no se pudo retomar la fila de la conexión directa", { org: organizationId, err });
    }
  }
}

async function resumeOrganization(organizationId: string, now: Date): Promise<void> {
  const db = getDb();
  const pendingDirect = [
    eq(schema.message.transport, "directa"),
    eq(schema.message.status, "pending"),
    isNull(schema.message.altMessageId),
    // La fila no pasa de 24 h: nada más viejo puede seguir pendiente aquí.
    gt(schema.message.createdAt, new Date(now.getTime() - MAX_QUEUE_MS - 60 * 60_000)),
  ];
  const queued = await db
    .select({ id: schema.message.id, at: schema.message.queuedUntil })
    .from(schema.message)
    .where(scoped(schema.message.organizationId, organizationId, ...pendingDirect, isNotNull(schema.message.queuedUntil)));
  for (const q of queued) scheduleDispatch(organizationId, q.id, q.at!);

  const stuck = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        ...pendingDirect,
        isNull(schema.message.queuedUntil),
        lt(schema.message.sentAt, new Date(now.getTime() - STUCK_SEND_MS))
      )
    );
  if (stuck.length > 0) {
    await db
      .update(schema.message)
      .set({ status: "failed", error: DIRECT_TIMEOUT_TEXT, failedAt: now })
      .where(scoped(schema.message.organizationId, organizationId, inArray(schema.message.id, stuck.map((s) => s.id)), eq(schema.message.status, "pending")));
    log.warn("envíos directos a medias marcados como fallidos", { org: organizationId, n: stuck.length });
  }
}

/** Solo pruebas. */
export function resetDirectQueueForTests(): void {
  const q = globalForQueue.__voceroDirectQueue;
  if (!q) return;
  for (const t of q.timers.values()) clearTimeout(t);
  q.timers.clear();
}
