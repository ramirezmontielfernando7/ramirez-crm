import { eq } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { runWithOrganization } from "@/lib/request-context";
import {
  activeAiBonus,
  AI_RESET_PRICE_MXN,
  billingState,
  DAY_MS,
  EXTRA_PRICE_MXN,
  EXTRA_STORAGE_GB,
  extendPaidUntil,
  monthKey,
  type BillingState,
  type PaymentKind,
} from "@/lib/billing";
import { orgBaseUsdLimit } from "@/server/ai-quota/choice";
import { getBillingRow, insertPayment, listPayments, saveBilling } from "@/server/billing/store";
import { getEffectiveLimits, saveOrgLimits } from "@/server/limits";
import { checkAllAlerts } from "@/server/limits/alerts";
import { platformOrgId } from "@/server/platform";
import { recordPlatformAudit, type AuditActor } from "./audit";
import { PlatformError } from "./organizations";

/**
 * 048 — Cobro a mano desde Plataforma (mientras no hay pasarela): prueba
 * gratis con fecha de fin, «pagado hasta», días de gracia, pagos y extras
 * vendidos con un clic. Cada cambio queda en la bitácora de plataforma. Solo
 * metadatos y montos: nunca contenido del negocio.
 */

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys() {
  return getSystemDb();
}

async function orgOrThrow(organizationId: string): Promise<{ id: string; name: string }> {
  const [org] = await sys()
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  if (!org) throw new PlatformError(404, "not_found", "Organización no encontrada");
  return org;
}

export type PaymentDto = {
  id: string;
  kind: PaymentKind;
  amountMxn: number;
  months: number | null;
  quantity: number;
  note: string | null;
  paidAt: string;
};

export type BillingDto = {
  trialEndsAt: string | null;
  paidUntil: string | null;
  graceDays: number;
  note: string | null;
  /** La IA extra de ESTE mes, en dólares (0 sin ella). */
  aiBonusUsd: number;
  state: BillingState;
  isPlatform: boolean;
  /** Precios sugeridos (MXN) para el formulario de pagos. */
  prices: Partial<Record<PaymentKind, number>>;
  payments: PaymentDto[];
};

export async function getOrgBilling(organizationId: string, now = new Date()): Promise<BillingDto> {
  await orgOrThrow(organizationId);
  const [row, payments, limits] = await Promise.all([
    getBillingRow(organizationId),
    listPayments(organizationId),
    runWithOrganization(organizationId, () => getEffectiveLimits(organizationId)),
  ]);
  const isPlatform = organizationId === platformOrgId();
  return {
    trialEndsAt: row?.trialEndsAt?.toISOString() ?? null,
    paidUntil: row?.paidUntil?.toISOString() ?? null,
    graceDays: row?.graceDays ?? 5,
    note: row?.note ?? null,
    aiBonusUsd: activeAiBonus(row?.aiBonusUsd != null ? Number(row.aiBonusUsd) : null, row?.aiBonusMonth ?? null, now),
    state: isPlatform ? billingState(null, now) : billingState(row ? { trialEndsAt: row.trialEndsAt, paidUntil: row.paidUntil, graceDays: row.graceDays } : null, now),
    isPlatform,
    prices: { ...EXTRA_PRICE_MXN, ai_reset: AI_RESET_PRICE_MXN[limits.planKey] ?? AI_RESET_PRICE_MXN.pro },
    payments: payments.map((p) => ({
      id: p.id,
      kind: p.kind,
      amountMxn: p.amountMxn,
      months: p.months,
      quantity: p.quantity,
      note: p.note,
      paidAt: p.paidAt.toISOString(),
    })),
  };
}

/**
 * Prueba gratis: `days` desde hoy (al final del día UTC no: exactamente N×24 h,
 * así «14 días» son 14 días), o `endsAt` exacto, o `null` para quitarla.
 */
export async function changeTrial(
  organizationId: string,
  input: { days: number } | { endsAt: Date | null },
  actor: AuditActor,
  ip: string | null,
  now = new Date()
): Promise<BillingDto> {
  const org = await orgOrThrow(organizationId);
  if (organizationId === platformOrgId()) throw new PlatformError(422, "platform_org", "La organización de la plataforma no lleva prueba ni cobro");
  const endsAt = "days" in input ? new Date(now.getTime() + input.days * DAY_MS) : input.endsAt;
  const { before } = await saveBilling(organizationId, { trialEndsAt: endsAt }, actor?.userId ?? null);
  await recordPlatformAudit({
    actor,
    action: "billing.trial_changed",
    org,
    detail: { de: before?.trialEndsAt?.toISOString() ?? null, a: endsAt?.toISOString() ?? null },
    ip,
  });
  return getOrgBilling(organizationId, now);
}

export async function changeBillingSettings(
  organizationId: string,
  patch: { graceDays?: number; note?: string | null; paidUntil?: Date | null },
  actor: AuditActor,
  ip: string | null
): Promise<BillingDto> {
  const org = await orgOrThrow(organizationId);
  if (organizationId === platformOrgId()) throw new PlatformError(422, "platform_org", "La organización de la plataforma no lleva prueba ni cobro");
  const { before, after } = await saveBilling(organizationId, patch, actor?.userId ?? null);
  await recordPlatformAudit({
    actor,
    action: "billing.settings_changed",
    org,
    detail: {
      ...(patch.graceDays !== undefined ? { gracia: { de: before?.graceDays ?? null, a: after.graceDays } } : {}),
      ...(patch.paidUntil !== undefined ? { pagado_hasta: { de: before?.paidUntil?.toISOString() ?? null, a: after.paidUntil?.toISOString() ?? null } } : {}),
      ...(patch.note !== undefined ? { nota: "cambió" } : {}),
    },
    ip,
  });
  return getOrgBilling(organizationId);
}

export type PaymentInput = {
  kind: PaymentKind;
  amountMxn: number;
  months?: number | null;
  quantity?: number;
  note?: string | null;
};

/**
 * Registra un pago y aplica su efecto en el acto:
 * - `plan`: alarga «pagado hasta» N meses.
 * - `ai_reset`: suma a la bolsa de IA de ESTE mes otra bolsa completa (por cada unidad).
 * - `extra_person`: +N personas en el tope.
 * - `extra_storage`: +50 GB por unidad en el tope de almacenamiento.
 * - `onboarding` / `other`: solo queda en la bitácora.
 */
export async function recordPayment(
  organizationId: string,
  input: PaymentInput,
  actor: AuditActor,
  ip: string | null,
  now = new Date()
): Promise<BillingDto> {
  const org = await orgOrThrow(organizationId);
  if (organizationId === platformOrgId()) throw new PlatformError(422, "platform_org", "La organización de la plataforma no lleva prueba ni cobro");
  const quantity = input.quantity ?? 1;
  const months = input.kind === "plan" ? (input.months ?? 1) : null;
  const efecto: Record<string, unknown> = {};

  if (input.kind === "plan") {
    const row = await getBillingRow(organizationId);
    const paidUntil = extendPaidUntil(row?.paidUntil ?? null, months!, now);
    await saveBilling(organizationId, { paidUntil }, actor?.userId ?? null);
    efecto.pagado_hasta = { de: row?.paidUntil?.toISOString() ?? null, a: paidUntil.toISOString() };
  } else if (input.kind === "ai_reset") {
    const base = await orgBaseUsdLimit(organizationId);
    if (base === null || base <= 0) {
      throw new PlatformError(422, "no_ai_cap", "Esta organización no tiene bolsa de IA en dólares: no hay nada que restablecer.");
    }
    const row = await getBillingRow(organizationId);
    const month = monthKey(now);
    const current = activeAiBonus(row?.aiBonusUsd != null ? Number(row.aiBonusUsd) : null, row?.aiBonusMonth ?? null, now);
    const bonus = current + base * quantity;
    await saveBilling(organizationId, { aiBonusUsd: bonus, aiBonusMonth: month }, actor?.userId ?? null);
    efecto.ia_extra_usd = { de: current, a: bonus, mes: month };
  } else if (input.kind === "extra_person" || input.kind === "extra_storage") {
    const limits = await runWithOrganization(organizationId, () => getEffectiveLimits(organizationId));
    if (input.kind === "extra_person") {
      const de = limits.members.value;
      if (de === null) throw new PlatformError(422, "no_cap", "Esta organización no tiene tope de personas: no hace falta vender una persona extra.");
      await saveOrgLimits(organizationId, { members: de + quantity }, actor?.userId ?? null);
      efecto.personas = { de, a: de + quantity };
    } else {
      const de = limits.storageBytes.value;
      if (de === null) throw new PlatformError(422, "no_cap", "Esta organización no tiene tope de almacenamiento: no hace falta vender espacio extra.");
      const a = de + EXTRA_STORAGE_GB * 1024 ** 3 * quantity;
      await saveOrgLimits(organizationId, { storageBytes: a }, actor?.userId ?? null);
      efecto.almacenamiento_bytes = { de, a };
    }
  }

  const payment = await insertPayment(
    organizationId,
    { kind: input.kind, amountMxn: input.amountMxn, months, quantity, note: input.note ?? null, paidAt: now },
    actor?.userId ?? null
  );
  await recordPlatformAudit({
    actor,
    action: "billing.payment_recorded",
    org,
    detail: { pago: payment.id, tipo: input.kind, monto_mxn: input.amountMxn, cantidad: quantity, ...(months ? { meses: months } : {}), ...efecto },
    ip,
  });
  await runWithOrganization(organizationId, () => checkAllAlerts(organizationId)).catch(() => undefined);
  return getOrgBilling(organizationId, now);
}
