import type { DirectInboxPayload } from "@/server/webhooks/inbox";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { DeviceMessage } from "@/lib/direct-inbound";
import { logger } from "@/lib/log";
import { runWithOrganization } from "@/lib/request-context";
import { connectionByWebhookHash } from "@/server/credentials/direct";
import { ingestDeviceEcho, ingestInboundMessage, mediaInputFrom } from "@/server/inbox/ingest";
import { isOrgActive } from "@/server/platform-admin/org-status";
import { hashToken } from "./link";
import { orgHasConexionDirecta } from "@/server/modules";
import { ingestGroupMessage } from "./groups";
import { isOrgWithoutMeta } from "./without-meta";

const log = logger("direct-connection");

/**
 * Conexión directa (PR 6) — Lo que ENTRA por el dispositivo vinculado
 * (`messages.upsert`). Los grupos siempre entran; los chats personales, solo
 * en una empresa SIN Meta. Con Meta, lo que escribe
 * el contacto ya entra por Meta y esto no hace nada (evita mensajes dobles).
 *
 * - Lo que escribe el contacto entra por la ingesta de siempre
 *   (`ingestInboundMessage`): contacto, lead, no leídos, bajas y la IA.
 * - Lo que el negocio manda (`fromMe`): si es un envío de Dashfort, se une a
 *   su fila por el ID del dispositivo (no se ve dos veces); si se escribió en
 *   el celular, entra como «Celular» y pausa la IA, igual que un eco de Meta.
 * - Idempotente: el `wa_message_id` es `direct.<key.id>` (un reintento del
 *   servidor no duplica).
 */

/**
 * De quién es el token del webhook (o null si no existe). Mi número (046):
 * `directNumberId` dice si es el de una persona; lo suyo aún no entra.
 */
export async function organizationForWebhook(token: string): Promise<{ organizationId: string; directNumberId: string | null } | null> {
  const row = await connectionByWebhookHash(hashToken(token));
  return row ? { organizationId: row.organizationId, directNumberId: row.directNumberId } : null;
}

/**
 * Un mensaje malo se registra y sigue con el siguiente. Sin `strict` nunca
 * lanza; con `strict` (la bandeja durable, DF-03) lanza AL FINAL si algo
 * falló, para que se reintente (lo ya registrado se deduplica).
 */
export async function ingestDeviceMessages(organizationId: string, messages: DeviceMessage[], opts: { strict?: boolean } = {}): Promise<number> {
  if (messages.length === 0) return 0;
  return runWithOrganization(organizationId, async () => {
    try {
      if (!(await orgHasConexionDirecta(organizationId))) return 0;
      if (!(await isOrgActive(organizationId))) {
        log.warn("mensajes del dispositivo de una organización no activa: descartados", { org: organizationId, n: messages.length });
        return 0;
      }
    } catch (err) {
      log.error("no se pudo revisar la organización del dispositivo vinculado", { org: organizationId, err });
      if (opts.strict) throw err;
      return 0;
    }
    const withoutMeta = await isOrgWithoutMeta(organizationId);
    let done = 0;
    let failed = 0;
    for (const m of messages) {
      try {
        if (m.group) { await ingestGroupMessage(organizationId, m); done++; }
        else if (withoutMeta && await ingestOne(organizationId, m)) done++;
      } catch (err) {
        failed++;
        log.error("no se pudo registrar un mensaje del dispositivo vinculado", { org: organizationId, err });
      }
    }
    if (opts.strict && failed > 0) throw new Error(`${failed} mensaje(s) del dispositivo vinculado no se registraron`);
    return done;
  });
}

async function ingestOne(organizationId: string, m: DeviceMessage): Promise<boolean> {
  const phone = m.phone ?? (m.lid ? await phoneByLid(organizationId, m.lid) : null);
  if (!phone) {
    // Solo vino el ID privado y no hay contacto que lo conozca: no hay a qué
    // teléfono asignarlo ni a dónde contestar.
    log.warn("mensaje del dispositivo sin teléfono del contacto: descartado", { org: organizationId });
    return false;
  }
  const message = m.fromMe ? { ...m.message, to: phone } : { ...m.message, from: phone };
  if (m.fromMe) {
    await ingestDeviceEcho(organizationId, message, m.keyId);
    return true;
  }
  await ingestInboundMessage({
    organizationId,
    identity: { identity: phone, phone, waUserId: null, profileName: m.pushName },
    waMessageId: message.id,
    type: message.type,
    text: message.text?.body ?? null,
    timestamp: message.timestamp,
    media: mediaInputFrom(message),
    device: { keyId: m.keyId, lid: m.lid },
  });
  return true;
}

/** El teléfono del contacto que ya tiene guardado este `@lid`. */
export async function phoneByLid(organizationId: string, lid: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ phone: schema.contact.phone })
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.waLid, lid)))
    .limit(1);
  return row?.phone ?? null;
}

/**
 * DF-03 — Procesa un aviso de mensajes del dispositivo vinculado guardado en
 * la bandeja durable: el de «Mi número» de una persona o el de la empresa.
 * Lanza si algo falló (la bandeja lo reintenta).
 */
export async function processDirectPayload(payload: DirectInboxPayload): Promise<void> {
  const { organizationId, directNumberId, messages } = payload;
  if (directNumberId) {
    const { ingestNumberMessages } = await import("@/server/mi-numero/inbound");
    await ingestNumberMessages({ organizationId, directNumberId }, messages.filter((m) => !m.group), { strict: true });
    return;
  }
  await ingestDeviceMessages(organizationId, messages, { strict: true });
}
