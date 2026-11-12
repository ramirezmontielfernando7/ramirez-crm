import { createHmac } from "node:crypto";
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/log";
import type { DeviceMessage } from "@/lib/direct-inbound";
import { openFromStorage, sealForStorage } from "@/server/credentials";
import { beginTask, isShuttingDown, onShutdown } from "@/server/shutdown";
import type { WebhookPayload } from "@/server/inbox/webhook";

/**
 * Auditoría DF-03 — Bandeja de entrada DURABLE de los webhooks.
 *
 * Antes, la ruta respondía «recibido» (200) y procesaba después: si el
 * proceso se caía o la base fallaba en ese intervalo, Meta (o el dispositivo
 * vinculado) ya no lo reenviaba y el mensaje se perdía sin rastro. Ahora:
 *
 * 1. La ruta GUARDA el evento en `webhook_inbox` (cifrado) y solo entonces
 *    responde 200. Si no se pudo guardar responde 500 y la fuente reintenta.
 * 2. En seguida lo procesa (`after()`), como antes: la bandeja no se siente
 *    más lenta.
 * 3. Si el procesamiento falla, la fila se queda y el trabajador de fondo la
 *    reintenta con espera creciente (30 s, 1 min, 2 min… hasta 1 h). Lo que
 *    dejó un contenedor caído lo retoma el siguiente al vencer su apartado.
 * 4. Al terminar bien, la fila se BORRA (no guardamos mensajes de más). Tras
 *    `MAX_ATTEMPTS` queda como `failed` 7 días, para diagnóstico, y se borra.
 *
 * Reprocesar es seguro: los mensajes se deduplican por `wa_message_id` y los
 * estados son monotónicos. Tabla de plataforma: solo el pool de sistema.
 */

export const MAX_ATTEMPTS = 10;
/** Tiempo que quien procesa aparta la fila (si se cae, otro la retoma después). */
const LOCK_MS = 10 * 60 * 1000;
const FAILED_RETENTION_DAYS = 7;
const TICK_MS = 15_000;
const BATCH = 20;

type InboxSource = "whatsapp" | "direct";

/** Lo que guarda el webhook del dispositivo vinculado (ya enrutado a su organización). */
export type DirectInboxPayload = {
  organizationId: string;
  directNumberId: string | null;
  messages: DeviceMessage[];
};

type Payloads = { whatsapp: WebhookPayload; direct: DirectInboxPayload };

const log = logger("webhook");

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys() {
  return getSystemDb();
}

function fingerprint(source: string, json: string): string {
  return createHmac("sha256", getEnv().BETTER_AUTH_SECRET).update(`${source}\u0000${json}`).digest("hex");
}

/** Espera antes del intento `attempts + 1`: 30 s, 1 min, 2 min… con tope de 1 h. */
function retryDelayMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 60 * 60 * 1000);
}

/**
 * Guarda el evento. LANZA si no pudo: la ruta responde entonces 500 y la
 * fuente lo reintenta. Devuelve el id de la fila (o null si el mismo evento
 * ya estaba guardado y pendiente: un reintento de Meta).
 */
export async function enqueueWebhookEvent<S extends InboxSource>(source: S, payload: Payloads[S]): Promise<string | null> {
  const json = JSON.stringify(payload);
  const sealed = sealForStorage(json);
  const id = newId("webhookInbox");
  const rows = await sys()
    .insert(schema.webhookInbox)
    .values({
      id,
      source,
      payloadHash: fingerprint(source, json),
      payloadCipher: sealed.cipher,
      payloadIv: sealed.iv,
      payloadTag: sealed.tag,
      keyVersion: sealed.keyVersion,
    })
    .onConflictDoNothing({ target: [schema.webhookInbox.payloadHash] })
    .returning({ id: schema.webhookInbox.id });
  return rows[0]?.id ?? null;
}

type Handler = (payload: unknown) => Promise<void>;

/** Quién procesa cada fuente (import perezoso: el módulo no arrastra la ingesta al arrancar). */
async function handlerFor(source: string): Promise<Handler | null> {
  if (source === "whatsapp") {
    const { processWhatsAppPayload } = await import("@/server/inbox/process-payload");
    return (p) => processWhatsAppPayload(p as WebhookPayload);
  }
  if (source === "direct") {
    const { processDirectPayload } = await import("@/server/direct-connection/inbound");
    return (p) => processDirectPayload(p as DirectInboxPayload);
  }
  return null;
}

/** Aparta la fila para procesarla (nadie más la toma mientras tanto). */
async function claim(id: string, now: Date) {
  const w = schema.webhookInbox;
  const [row] = await sys()
    .update(w)
    .set({ lockedUntil: new Date(now.getTime() + LOCK_MS), attempts: sql`${w.attempts} + 1` })
    .where(and(eq(w.id, id), eq(w.status, "pending"), or(isNull(w.lockedUntil), lt(w.lockedUntil, now))))
    .returning();
  return row ?? null;
}

/** Texto corto del error, SIN contenido del mensaje (solo nombre y mensaje del error). */
function errorText(err: unknown): string {
  const e = err as { name?: string; message?: string; code?: string } | null;
  return [e?.name, e?.code, e?.message].filter(Boolean).join(": ").slice(0, 300) || String(err).slice(0, 300);
}

/**
 * Procesa UNA fila de la bandeja. Nunca lanza. Devuelve `done` (procesada y
 * borrada), `retry` (falló; se reintenta luego), `failed` (se agotaron los
 * intentos) o `skipped` (otro la tiene, o ya no está).
 */
export async function processWebhookEvent(id: string, now = new Date()): Promise<"done" | "retry" | "failed" | "skipped"> {
  const w = schema.webhookInbox;
  let row: Awaited<ReturnType<typeof claim>>;
  try {
    row = await claim(id, now);
  } catch (err) {
    log.error("no se pudo apartar un webhook guardado (lo retoma el trabajador)", { id, err });
    return "skipped";
  }
  if (!row) return "skipped";
  try {
    const opened = openFromStorage(row.payloadCipher, row.payloadIv, row.payloadTag, row.keyVersion);
    if (!opened.ok) throw new Error(`no se pudo descifrar (${opened.error})`);
    const handler = await handlerFor(row.source);
    if (!handler) throw new Error(`fuente desconocida: ${row.source}`);
    await handler(JSON.parse(opened.value));
  } catch (err) {
    const failed = row.attempts >= MAX_ATTEMPTS;
    log[failed ? "error" : "warn"](
      failed
        ? "un webhook guardado agotó sus intentos: queda como fallido 7 días (Plataforma → revisar el log)"
        : "un webhook guardado falló al procesarse: se reintentará",
      { id, fuente: row.source, intento: row.attempts, err }
    );
    try {
      await sys()
        .update(w)
        .set({
          status: failed ? "failed" : "pending",
          lockedUntil: null,
          nextAttemptAt: new Date(Date.now() + retryDelayMs(row.attempts)),
          lastError: errorText(err),
        })
        .where(eq(w.id, id));
    } catch (e) {
      // Sin esto, el apartado vence solo y el trabajador lo retoma.
      log.error("no se pudo reprogramar un webhook guardado", { id, err: e });
    }
    return failed ? "failed" : "retry";
  }
  try {
    await sys().delete(w).where(eq(w.id, id));
  } catch (err) {
    // Se reprocesará cuando venza el apartado: es idempotente.
    log.warn("webhook procesado pero no se pudo borrar de la bandeja", { id, err });
  }
  return "done";
}

/**
 * Agenda el procesamiento inmediato tras responder (la ruta lo llama con
 * `after`). El apagado ordenado lo espera.
 */
export function processSoon(id: string, schedule: (fn: () => Promise<void>) => void): void {
  const task = beginTask("webhook:inbox");
  schedule(async () => {
    try {
      await processWebhookEvent(id);
    } finally {
      task.end();
    }
  });
}

/** Lo vencido: pendiente, con su hora de reintento cumplida y sin nadie procesándolo. */
export async function dueWebhookEvents(now = new Date(), limit = BATCH): Promise<string[]> {
  const w = schema.webhookInbox;
  const rows = await sys()
    .select({ id: w.id })
    .from(w)
    .where(and(eq(w.status, "pending"), lte(w.nextAttemptAt, now), or(isNull(w.lockedUntil), lt(w.lockedUntil, now))))
    .orderBy(w.receivedAt)
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Borra los fallidos que pasaron la retención. */
export async function purgeFailedWebhookEvents(now = new Date()): Promise<number> {
  const w = schema.webhookInbox;
  const limite = new Date(now.getTime() - FAILED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const rows = await sys()
    .delete(w)
    .where(and(inArray(w.status, ["failed"]), lt(w.receivedAt, limite)))
    .returning({ id: w.id });
  return rows.length;
}

/** Una vuelta del trabajador: reintenta lo vencido y limpia lo viejo. */
export async function webhookInboxTick(now = new Date()): Promise<number> {
  let processed = 0;
  for (const id of await dueWebhookEvents(now)) {
    if (isShuttingDown()) break;
    const task = beginTask("webhook:inbox");
    try {
      if ((await processWebhookEvent(id)) === "done") processed++;
    } finally {
      task.end();
    }
  }
  const purged = await purgeFailedWebhookEvents(now);
  if (purged > 0) log.info(`webhook_inbox: ${purged} evento(s) fallido(s) de más de ${FAILED_RETENTION_DAYS} días borrado(s)`);
  return processed;
}

const globalForInbox = globalThis as unknown as { __voceroWebhookInbox?: NodeJS.Timeout; __voceroWebhookInboxBusy?: boolean };

/** Al arrancar y cada 15 s: retoma lo que quedó pendiente (de este o de un contenedor anterior). */
export function startWebhookInboxWorker(): void {
  if (globalForInbox.__voceroWebhookInbox) return;
  const run = async () => {
    if (globalForInbox.__voceroWebhookInboxBusy || isShuttingDown()) return;
    globalForInbox.__voceroWebhookInboxBusy = true;
    try {
      const n = await webhookInboxTick();
      if (n > 0) log.info(`webhook_inbox: ${n} evento(s) pendiente(s) procesado(s)`);
    } catch (err) {
      log.error("el trabajador de la bandeja de webhooks falló", { err });
    } finally {
      globalForInbox.__voceroWebhookInboxBusy = false;
    }
  };
  onShutdown("bandeja de webhooks", {
    stop: () => {
      if (globalForInbox.__voceroWebhookInbox) clearInterval(globalForInbox.__voceroWebhookInbox);
    },
  });
  void run();
  globalForInbox.__voceroWebhookInbox = setInterval(() => void run(), TICK_MS);
  globalForInbox.__voceroWebhookInbox.unref();
}
