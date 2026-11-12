import { desc } from "drizzle-orm";
import { scoped } from "@/lib/db/tenant";
import { getSystemDb, schema, type Db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { logger } from "@/lib/log";
import {
  activeAiBonus,
  billingState,
  DEFAULT_GRACE_DAYS,
  restrictionReason,
  type BillingState,
  type PaymentKind,
} from "@/lib/billing";
import { AI_KILLED_DETAIL } from "@/lib/platform-controls";
import { platformOrgId } from "@/server/platform";
import { isKilled } from "@/server/platform-controls/store";

const log = logger("billing");

/**
 * 048 — Cobro a mano: ÚNICA puerta de `organization_billing` y
 * `organization_payment`. Se lee con el pool de sistema y la organización
 * explícita (como los módulos y el estado): lo consultan caminos calientes
 * (cada llamada a la IA, el despachador de campañas) que a veces aún no
 * tienen contexto. Se recuerda unos segundos por proceso; quien escribe en
 * este proceso lo olvida al instante.
 *
 * Sin fila, `none`: la organización opera como siempre. La organización de
 * la plataforma nunca queda restringida.
 */

export type BillingRow = typeof schema.organizationBilling.$inferSelect;
export type PaymentRow = typeof schema.organizationPayment.$inferSelect;

const TTL_MS = 5_000;
const g = globalThis as unknown as { __voceroBilling?: Map<string, { row: BillingRow | null; at: number }> };
const cache = () => (g.__voceroBilling ??= new Map());

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys(): Db {
  return getSystemDb();
}

export function forgetBilling(organizationId?: string): void {
  if (organizationId) cache().delete(organizationId);
  else cache().clear();
}

export async function getBillingRow(organizationId: string): Promise<BillingRow | null> {
  const hit = cache().get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.row;
  const [row] = await sys()
    .select()
    .from(schema.organizationBilling)
    .where(scoped(schema.organizationBilling.organizationId, organizationId))
    .limit(1);
  cache().set(organizationId, { row: row ?? null, at: Date.now() });
  return row ?? null;
}

/** El estado comercial de hoy. */
export async function getBillingState(organizationId: string, now: Date = new Date()): Promise<BillingState> {
  if (organizationId === platformOrgId()) return billingState(null, now);
  const row = await getBillingRow(organizationId);
  return billingState(row ? { trialEndsAt: row.trialEndsAt, paidUntil: row.paidUntil, graceDays: row.graceDays } : null, now);
}

/**
 * ¿Se frena la IA de esta organización? Devuelve el texto para quien la usa,
 * o `null` si puede seguir. Por el interruptor de emergencia de la
 * plataforma o porque la prueba terminó / el pago venció. Si la lectura
 * falla, no se frena (queda en el log).
 */
export async function aiBlockedDetail(organizationId: string): Promise<string | null> {
  if (await isKilled("ai")) return AI_KILLED_DETAIL;
  try {
    const s = await getBillingState(organizationId);
    if (s.restricted) return `La IA está en pausa porque ${restrictionReason(s.kind)}. El chat humano sigue disponible.`;
  } catch (err) {
    log.error("no se pudo leer el cobro de la organización; la IA sigue", { org: organizationId, err });
  }
  return null;
}

/**
 * ¿Se frenan los envíos de campañas? El motivo (para la campaña pausada y la
 * respuesta al lanzar) o `null`.
 */
export async function campaignsBlockedReason(organizationId: string): Promise<string | null> {
  if (await isKilled("campaigns")) return "la plataforma pausó las campañas por mantenimiento";
  try {
    const s = await getBillingState(organizationId);
    if (s.restricted) return restrictionReason(s.kind);
  } catch (err) {
    log.error("no se pudo leer el cobro de la organización; las campañas siguen", { org: organizationId, err });
  }
  return null;
}

/** La IA extra de ESTE mes («restablecer la IA»), en dólares; 0 sin ella. */
export async function getAiBonusUsd(organizationId: string, now: Date = new Date()): Promise<number> {
  try {
    const row = await getBillingRow(organizationId);
    return activeAiBonus(row?.aiBonusUsd != null ? Number(row.aiBonusUsd) : null, row?.aiBonusMonth ?? null, now);
  } catch (err) {
    log.error("no se pudo leer la IA extra del mes", { org: organizationId, err });
    return 0;
  }
}

/* ───────── Escritura (solo el administrador de plataforma) ───────── */

export type BillingPatch = {
  trialEndsAt?: Date | null;
  paidUntil?: Date | null;
  graceDays?: number;
  note?: string | null;
  aiBonusUsd?: number | null;
  aiBonusMonth?: string | null;
};

/** Cambia la fila (la crea si no existe). Devuelve antes y después. */
export async function saveBilling(
  organizationId: string,
  patch: BillingPatch,
  actorUserId: string | null
): Promise<{ before: BillingRow | null; after: BillingRow }> {
  forgetBilling(organizationId);
  const before = await getBillingRow(organizationId);
  const values = {
    trialEndsAt: patch.trialEndsAt === undefined ? (before?.trialEndsAt ?? null) : patch.trialEndsAt,
    paidUntil: patch.paidUntil === undefined ? (before?.paidUntil ?? null) : patch.paidUntil,
    graceDays: patch.graceDays ?? before?.graceDays ?? DEFAULT_GRACE_DAYS,
    note: patch.note === undefined ? (before?.note ?? null) : patch.note?.trim() || null,
    aiBonusUsd: patch.aiBonusUsd === undefined ? (before?.aiBonusUsd ?? null) : patch.aiBonusUsd === null ? null : patch.aiBonusUsd.toFixed(4),
    aiBonusMonth: patch.aiBonusMonth === undefined ? (before?.aiBonusMonth ?? null) : patch.aiBonusMonth,
    updatedAt: new Date(),
    updatedBy: actorUserId,
  };
  const [after] = await sys()
    .insert(schema.organizationBilling)
    .values({ organizationId, ...values })
    .onConflictDoUpdate({ target: schema.organizationBilling.organizationId, set: values })
    .returning();
  forgetBilling(organizationId);
  return { before, after: after! };
}

export async function insertPayment(
  organizationId: string,
  input: { kind: PaymentKind; amountMxn: number; months: number | null; quantity: number; note: string | null; paidAt: Date },
  actorUserId: string | null
): Promise<PaymentRow> {
  const [row] = await sys()
    .insert(schema.organizationPayment)
    .values({ id: newId("payment"), organizationId, ...input, note: input.note?.trim() || null, recordedBy: actorUserId })
    .returning();
  return row!;
}

export async function listPayments(organizationId: string, limit = 50): Promise<PaymentRow[]> {
  return sys()
    .select()
    .from(schema.organizationPayment)
    .where(scoped(schema.organizationPayment.organizationId, organizationId))
    .orderBy(desc(schema.organizationPayment.paidAt))
    .limit(limit);
}

/** Las filas de cobro de VARIAS organizaciones en una lectura (la lista de /platform). */
export async function getManyBillingRows(): Promise<Map<string, BillingRow>> {
  const rows = await sys().select().from(schema.organizationBilling);
  return new Map(rows.map((r) => [r.organizationId, r]));
}
