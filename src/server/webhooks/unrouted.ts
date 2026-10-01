import { createHmac } from "node:crypto";
import { count, lt } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/log";
import { sealForStorage } from "@/server/credentials";

/**
 * Fase 3, PR 1 — Eventos de webhook que no se pudieron enrutar.
 *
 * Antes, un evento FIRMADO por Meta para un número, WABA o página que ninguna
 * organización tiene conectada se descartaba con un aviso: un mensaje que
 * llegaba justo antes de terminar la conexión se perdía sin rastro. Ahora se
 * guarda en `webhook_unrouted` (tabla de plataforma, pool de sistema):
 *
 * - CIFRADO (puede traer mensajes de clientes) y jamás al log: el log solo
 *   dice fuente, tipo de llave, llave y campo.
 * - 7 días: `purgeUnrouted()` al arrancar y cada hora.
 * - Sin reprocesamiento automático ni pantalla (decisión de la Fase 3: ver
 *   docs/credenciales.md).
 * - Solo eventos que pasaron la firma: un evento sin firma válida nunca
 *   llega aquí (sería una forma gratis de llenar la tabla).
 */

export const UNROUTED_RETENTION_DAYS = 7;
/** Tope de filas: un número mal configurado no llena el disco. */
export const UNROUTED_MAX_ROWS = 5000;

export type UnroutedSource = "whatsapp" | "instagram" | "messenger";
export type UnroutedRouteKind = "phone_number_id" | "waba_id" | "ig_user_id" | "page_id" | "account_ref";

/** Fase 3, PR 2: por qué no se procesó (nadie lo tiene, o su organización no opera). */
export function unroutedReasonFor(orgStatus: "active" | "suspended" | "deleted"): string {
  return orgStatus === "deleted" ? "org_deleted" : "org_suspended";
}

const log = logger("webhook");

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys() {
  return getSystemDb();
}

/** Huella para no duplicar reintentos de Meta. Con llave: no se puede adivinar el contenido por su hash. */
function fingerprint(parts: string[]): string {
  return createHmac("sha256", getEnv().BETTER_AUTH_SECRET).update(parts.join("\u0000")).digest("hex");
}

/**
 * Guarda el evento. NUNCA lanza: falle lo que falle, el webhook sigue (lo que
 * no se pudo guardar queda en el log, sin contenido).
 */
export async function recordUnrouted(input: {
  source: UnroutedSource;
  routeKind: UnroutedRouteKind;
  routeKey: string;
  field: string | null;
  payload: unknown;
  reason?: string;
}): Promise<void> {
  const reason = input.reason ?? "unknown_route";
  const meta = { fuente: input.source, llave: input.routeKind, valor: input.routeKey, campo: input.field ?? "-", motivo: reason };
  try {
    const [{ n } = { n: 0 }] = await sys().select({ n: count() }).from(schema.webhookUnrouted);
    if (n >= UNROUTED_MAX_ROWS) {
      log.warn("evento sin organización NO guardado: webhook_unrouted llegó a su tope", { ...meta, tope: UNROUTED_MAX_ROWS });
      return;
    }
    const json = JSON.stringify(input.payload ?? null);
    const sealed = sealForStorage(json);
    await sys()
      .insert(schema.webhookUnrouted)
      .values({
        id: newId("webhookUnrouted"),
        source: input.source,
        routeKind: input.routeKind,
        routeKey: input.routeKey,
        field: input.field,
        reason,
        payloadHash: fingerprint([input.source, input.routeKind, input.routeKey, input.field ?? "", json]),
        payloadCipher: sealed.cipher,
        payloadIv: sealed.iv,
        payloadTag: sealed.tag,
        keyVersion: sealed.keyVersion,
      })
      .onConflictDoNothing({ target: [schema.webhookUnrouted.payloadHash] });
    log.warn(
      "evento sin organización: guardado 7 días en webhook_unrouted (si es tu número, guarda la conexión en Ajustes)",
      meta
    );
  } catch (err) {
    log.error("no se pudo guardar un evento sin organización", { ...meta, err });
  }
}

/** Borra lo que pasó la retención. Devuelve cuántas filas borró. */
export async function purgeUnrouted(now = new Date()): Promise<number> {
  const limite = new Date(now.getTime() - UNROUTED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const borradas = await sys()
    .delete(schema.webhookUnrouted)
    .where(lt(schema.webhookUnrouted.receivedAt, limite))
    .returning({ id: schema.webhookUnrouted.id });
  return borradas.length;
}

const globalForPurge = globalThis as unknown as { __voceroUnroutedPurge?: NodeJS.Timeout };

/** Limpieza al arrancar y luego cada hora (en proceso, como el resto del trabajo de fondo). */
export async function startUnroutedPurge(): Promise<void> {
  const run = async () => {
    try {
      const n = await purgeUnrouted();
      if (n > 0) log.info(`webhook_unrouted: ${n} evento(s) de más de ${UNROUTED_RETENTION_DAYS} días borrado(s)`);
    } catch (err) {
      log.error("no se pudo limpiar webhook_unrouted", { err });
    }
  };
  await run();
  if (!globalForPurge.__voceroUnroutedPurge) {
    globalForPurge.__voceroUnroutedPurge = setInterval(run, 60 * 60 * 1000);
    globalForPurge.__voceroUnroutedPurge.unref();
  }
}
