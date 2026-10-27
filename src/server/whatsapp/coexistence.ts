import { eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { graphRequest, normalizeMx } from "@/lib/meta/client";
import { logger } from "@/lib/log";
import { runWithOrganization } from "@/lib/request-context";
import { resolveWhatsAppNumber } from "@/server/credentials/resolve";
import { publish } from "@/server/events/bus";
import { getOrCreateContactByIdentity } from "@/server/inbox/identity";
import { attachMediaAsset, getOrCreateConversation, mediaInputFrom } from "@/server/inbox/ingest";
import type { WebhookMessage } from "@/server/inbox/webhook";
import { recordUnrouted, unroutedReasonFor } from "@/server/webhooks/unrouted";

const log = logger("coexistencia");

/**
 * Tech Provider, PR 3 — Coexistencia: el negocio conectó con «Conectar con
 * Facebook» el número que YA usa en la app de WhatsApp Business del celular.
 *
 * Meta deja traer, UNA sola vez y dentro de las primeras 24 h, sus contactos
 * (`smb_app_state_sync`) y los chats individuales de los últimos 6 meses
 * (`history`). Se piden al conectar y llegan por el webhook de siempre.
 *
 * Reglas: lo importado es HISTORIA. No dispara al agente, no pausa la IA, no
 * crea leads, no cuenta como no leído ni abre la ventana de 24 h, y nunca
 * borra nada del CRM (un contacto que el negocio borra del celular se queda).
 */

export type SyncType = "smb_app_state_sync" | "history";

/**
 * `POST {phone}/smb_app_data` por cada tipo. Best-effort: si Meta falla se
 * registra y sigue (la conexión ya quedó hecha). Jamás lanza.
 */
export async function requestCoexistenceSync(phoneNumberId: string, token: string): Promise<Record<SyncType, boolean>> {
  const result: Record<SyncType, boolean> = { smb_app_state_sync: false, history: false };
  for (const syncType of ["smb_app_state_sync", "history"] as const) {
    try {
      const res = await graphRequest<{ request_id?: string } | null>(`${phoneNumberId}/smb_app_data`, {
        method: "POST",
        token,
        body: { messaging_product: "whatsapp", sync_type: syncType },
      });
      result[syncType] = true;
      log.info("sincronización de coexistencia pedida", { phone: phoneNumberId, tipo: syncType, solicitud: res?.request_id ?? "-" });
    } catch (err) {
      log.warn("Meta no aceptó la sincronización de coexistencia", { phone: phoneNumberId, tipo: syncType, err });
    }
  }
  return result;
}

type HistoryMessage = WebhookMessage & { history_context?: { status?: string } };

type HistoryBatch = {
  metadata?: { phase?: number; chunk_order?: number; progress?: number };
  threads?: { id?: string; messages?: HistoryMessage[] }[];
  errors?: { code?: number; message?: string }[];
};

export type HistoryValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  history?: HistoryBatch[];
};

type StateSyncEntry = {
  type?: string;
  action?: string;
  contact?: { full_name?: string; first_name?: string; phone_number?: string };
};

export type StateSyncValue = {
  metadata?: { phone_number_id?: string };
  state_sync?: StateSyncEntry[];
};

/** Tipos que se guardan con contenido; `media_placeholder` espera su archivo. */
const HISTORY_TYPES = new Set([
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contacts",
  "media_placeholder",
]);

const STATUS_FROM_HISTORY: Record<string, "sent" | "delivered" | "read" | "failed"> = {
  SENT: "sent",
  PENDING: "sent",
  DELIVERED: "delivered",
  READ: "read",
  PLAYED: "read",
  ERROR: "failed",
};

/** Enruta un evento de coexistencia a su organización (o lo guarda sin ruta). */
async function routeOrUnrouted(phoneNumberId: string | undefined, field: string, value: unknown): Promise<string | null> {
  if (!phoneNumberId) return null;
  const route = await resolveWhatsAppNumber(phoneNumberId);
  if (!route) {
    await recordUnrouted({ source: "whatsapp", routeKind: "phone_number_id", routeKey: phoneNumberId, field, payload: value });
    return null;
  }
  if (route.orgStatus !== "active") {
    await recordUnrouted({
      source: "whatsapp",
      routeKind: "phone_number_id",
      routeKey: phoneNumberId,
      field,
      payload: value,
      reason: unroutedReasonFor(route.orgStatus),
    });
    return null;
  }
  return route.organizationId;
}

/** Webhook `history`: los chats de los últimos 6 meses, por lotes. */
export async function processHistoryValue(value: HistoryValue): Promise<void> {
  const organizationId = await routeOrUnrouted(value.metadata?.phone_number_id, "history", value);
  if (!organizationId) return;
  const businessNumber = normalizeMx(value.metadata?.display_phone_number ?? "");

  await runWithOrganization(organizationId, async () => {
    for (const batch of value.history ?? []) {
      if (batch.errors?.length) {
        // 2593109: el negocio decidió no compartir su historial.
        log.info("el negocio no compartió su historial", { org: organizationId, codigo: batch.errors[0]?.code ?? "-" });
        continue;
      }
      let imported = 0;
      for (const thread of batch.threads ?? []) {
        try {
          imported += await importThread(organizationId, businessNumber, thread);
        } catch (err) {
          // Un chat malformado jamás tumba el webhook.
          log.error("no se pudo importar un chat del historial", { org: organizationId, err });
        }
      }
      log.info("historial importado", {
        org: organizationId,
        fase: batch.metadata?.phase ?? "-",
        lote: batch.metadata?.chunk_order ?? "-",
        avance: batch.metadata?.progress ?? "-",
        mensajes: imported,
      });
    }
  });
}

async function importThread(
  organizationId: string,
  businessNumber: string,
  thread: { id?: string; messages?: HistoryMessage[] }
): Promise<number> {
  if (!thread.id) return 0;
  const identity = normalizeMx(thread.id);
  const { contact } = await getOrCreateContactByIdentity(organizationId, {
    identity,
    phone: identity,
    waUserId: null,
    profileName: null,
  });
  const conversation = await getOrCreateConversation(organizationId, contact.id);
  const db = getDb();

  let imported = 0;
  let newest: Date | null = null;
  for (const msg of thread.messages ?? []) {
    if (!msg.id || !HISTORY_TYPES.has(msg.type)) continue;
    // Lo que mandó el negocio trae `to` (eco); si no, se compara el remitente.
    const fromBusiness = Boolean(msg.to) || (businessNumber !== "" && normalizeMx(msg.from ?? "") === businessNumber);
    const at = toDate(msg.timestamp);
    const media = mediaInputFrom(msg);
    const text = msg.text?.body ?? (media?.caption || null);

    const inserted = await db
      .insert(schema.message)
      .values({
        id: newId("message"),
        organizationId,
        conversationId: conversation.id,
        waMessageId: msg.id,
        direction: fromBusiness ? "out" : "in",
        type: msg.type,
        text,
        status: fromBusiness ? (STATUS_FROM_HISTORY[msg.history_context?.status ?? ""] ?? "sent") : "delivered",
        ...(fromBusiness ? { origin: "manual" as const } : {}),
        waTimestamp: at,
      })
      .onConflictDoNothing({ target: [schema.message.waMessageId] })
      .returning({ id: schema.message.id });

    let messageId = inserted[0]?.id ?? null;
    if (!messageId && media) {
      // Meta manda después el archivo de un mensaje que llegó como
      // `media_placeholder` (solo los de los últimos 14 días): se completa.
      const upgraded = await db
        .update(schema.message)
        .set({ type: msg.type, text })
        .where(
          scoped(schema.message.organizationId, organizationId,
            eq(schema.message.waMessageId, msg.id),
            eq(schema.message.type, "media_placeholder"),
            isNull(schema.message.mediaAssetId)
          )
        )
        .returning({ id: schema.message.id });
      messageId = upgraded[0]?.id ?? null;
    } else if (messageId) {
      imported++;
      if (!newest || at > newest) newest = at;
    }
    if (messageId && media) await attachMediaAsset(organizationId, messageId, media);
  }

  if (newest) {
    const iso = newest.toISOString();
    // Solo la hora del último mensaje (para el orden de la Bandeja), y solo
    // si es más nueva: lo importado no abre la ventana de 24 h ni suma no leídos.
    await db
      .update(schema.conversation)
      .set({
        lastMessageAt: sql`greatest(coalesce(${schema.conversation.lastMessageAt}, ${iso}::timestamp), ${iso}::timestamp)`,
        updatedAt: new Date(),
      })
      .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversation.id)));
  }
  if (imported > 0) {
    publish(organizationId, { type: "conversation.updated", data: { conversation: { id: conversation.id } } });
  }
  return imported;
}

/** Webhook `smb_app_state_sync`: los contactos del celular. */
export async function processStateSyncValue(value: StateSyncValue): Promise<void> {
  const organizationId = await routeOrUnrouted(value.metadata?.phone_number_id, "smb_app_state_sync", value);
  if (!organizationId) return;

  await runWithOrganization(organizationId, async () => {
    let added = 0;
    for (const entry of value.state_sync ?? []) {
      if (entry.type !== "contact" || entry.action !== "add") continue; // «remove»: el CRM no borra
      const phone = entry.contact?.phone_number;
      if (!phone) continue;
      const identity = normalizeMx(phone);
      const name = entry.contact?.full_name?.trim() || entry.contact?.first_name?.trim() || null;
      try {
        await getOrCreateContactByIdentity(organizationId, { identity, phone: identity, waUserId: null, profileName: name });
        added++;
      } catch (err) {
        log.error("no se pudo importar un contacto del celular", { org: organizationId, err });
      }
    }
    log.info("contactos del celular importados", { org: organizationId, contactos: added });
  });
}

function toDate(timestamp: string | undefined): Date {
  const n = Number(timestamp);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}
