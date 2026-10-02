import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { describeSendError } from "@/lib/meta/send-errors";
import { publish } from "@/server/events/bus";
import type { WebhookStatus } from "@/server/inbox/webhook";
import { logger } from "@/lib/log";

const log = logger("status");

type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

/**
 * Desde qué estados se puede llegar a cada uno. El orden es monotónico: un
 * `delivered` tardío no pisa `read`, y (Campañas v2) un `failed` tardío no
 * pisa un `delivered` ni un `read`: si Meta ya confirmó la entrega, un fallo
 * que llega después no la deshace. `failed` es terminal.
 */
const ALLOWED_FROM: Record<Exclude<MessageStatus, "pending">, MessageStatus[]> = {
  sent: ["pending"],
  delivered: ["pending", "sent"],
  read: ["pending", "sent", "delivered"],
  failed: ["pending", "sent"],
};

function isKnownStatus(s: string): s is keyof typeof ALLOWED_FROM {
  return Object.hasOwn(ALLOWED_FROM, s);
}

export function isUpgrade(current: string, next: string): boolean {
  if (!isKnownStatus(next)) return false;
  return (ALLOWED_FROM[next] as string[]).includes(current);
}

/** `timestamp` de Meta (segundos Unix, como texto) → Date; null si no sirve. */
export function statusTime(timestamp: string | undefined): Date | null {
  const n = Number(timestamp);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
}

/** Objeto `pricing` del webhook, normalizado; null si Meta no lo mandó. */
export function pricingOf(status: WebhookStatus): {
  billable: boolean | null;
  category: string | null;
  model: string | null;
  type: string | null;
} | null {
  const p = status.pricing;
  if (!p || typeof p !== "object") return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 64) : null);
  return {
    billable: typeof p.billable === "boolean" ? p.billable : null,
    category: str(p.category),
    model: str(p.pricing_model),
    type: str(p.type),
  };
}

const TIME_KEY = { sent: "sentAt", delivered: "deliveredAt", read: "readAt" } as const;

/**
 * Aplica un estado del webhook. Dos sentencias, cada una atómica (sin leer
 * y luego escribir: dos webhooks simultáneos no pueden degradar el estado):
 *
 * 1. La transición: `UPDATE … WHERE status IN (<estados previos válidos>)`.
 *    Solo si cambió algo se publica por SSE.
 * 2. La hora del estado y el `pricing`: se guardan aunque el estado llegue
 *    fuera de orden (un `delivered` que llega después del `read` deja su
 *    hora), y cada uno una sola vez (`coalesce`: el primero gana). Un
 *    `failed` tardío no deja nada: ni hora ni error.
 */
export async function applyStatusUpdate(
  organizationId: string,
  status: WebhookStatus
): Promise<void> {
  const next = status.status;
  if (!isKnownStatus(next)) return; // estado desconocido

  const db = getDb();
  const at = statusTime(status.timestamp) ?? new Date();
  const byWamid = scoped(schema.message.organizationId, organizationId, eq(schema.message.waMessageId, status.id));

  const failure = status.errors?.[0];
  const errorCode = typeof failure?.code === "number" ? failure.code : null;
  const error =
    next === "failed"
      ? describeSendError(errorCode, failure?.error_data?.details ?? failure?.message ?? failure?.title)
      : null;

  const changed = await db
    .update(schema.message)
    .set(
      next === "failed"
        ? { status: next, error, errorCode, failedAt: at }
        : { status: next, error: null, errorCode: null }
    )
    .where(and(byWamid, inArray(schema.message.status, ALLOWED_FROM[next])))
    .returning({ id: schema.message.id, conversationId: schema.message.conversationId });

  const pricing = pricingOf(status);
  if (next !== "failed" || pricing) {
    const patch: Record<string, unknown> = {};
    if (next !== "failed") {
      const key = TIME_KEY[next];
      // Texto + cast: la columna es `timestamp` (UTC, ver schema.ts).
      patch[key] = sql`coalesce(${schema.message[key]}, ${at.toISOString()}::timestamp)`;
    }
    if (pricing) {
      patch.pricingBillable = sql`coalesce(${schema.message.pricingBillable}, ${pricing.billable}::boolean)`;
      patch.pricingCategory = sql`coalesce(${schema.message.pricingCategory}, ${pricing.category}::text)`;
      patch.pricingModel = sql`coalesce(${schema.message.pricingModel}, ${pricing.model}::text)`;
      patch.pricingType = sql`coalesce(${schema.message.pricingType}, ${pricing.type}::text)`;
    }
    await db.update(schema.message).set(patch).where(byWamid);
  }

  const msg = changed[0];
  if (!msg) {
    if (next === "failed") {
      log.info("failed tardío ignorado: el mensaje ya estaba entregado, leído o no existe", {
        org: organizationId,
        codigo: errorCode,
      });
    }
    return;
  }

  publish(organizationId, {
    type: "message.status",
    data: {
      conversationId: msg.conversationId,
      messageId: msg.id,
      status: next,
      // Sin esto el operador ve el triángulo de fallo pero nunca el motivo.
      error,
    },
  });
}
