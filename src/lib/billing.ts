/**
 * 048 — Cobro a mano mientras no hay pasarela: reglas PURAS (sin BD) del
 * estado comercial de una organización, de los pagos y de los extras. Lo
 * guarda `organization_billing` (única puerta `src/server/billing/store.ts`).
 *
 * Estados:
 * - `none`: sin prueba ni «pagado hasta»; opera como siempre (las que ya
 *   existían y las que se cobran por fuera).
 * - `trial` / `trial_ending` (faltan 3 días o menos) / `trial_expired`.
 * - `paid` / `due` (vence en 3 días o menos) / `grace` (venció, pero dentro
 *   de los días de gracia) / `overdue` (pasó la gracia: suspensión suave).
 *
 * Con `trial_expired` u `overdue` la organización queda RESTRINGIDA: se
 * apagan la IA y los envíos de campañas, y sale un aviso; la Bandeja sigue
 * recibiendo y enviando mensajes de personas (nunca se pierde un chat). La
 * suspensión de siempre (`organization.status = suspended`) es otra cosa,
 * más dura, y sigue a mano.
 */

export const DAY_MS = 86_400_000;
/** Cuántos días antes se avisa que la prueba o el pago vencen. */
const WARN_DAYS = 3;
export const DEFAULT_GRACE_DAYS = 5;
export const DEFAULT_TRIAL_DAYS = 14;

export type BillingKind = "none" | "trial" | "trial_ending" | "trial_expired" | "paid" | "due" | "grace" | "overdue";

type BillingInput = {
  trialEndsAt: Date | null;
  paidUntil: Date | null;
  graceDays: number;
};

export type BillingState = {
  kind: BillingKind;
  /** La IA y las campañas, apagadas por falta de pago o fin de la prueba. */
  restricted: boolean;
  /** Días que faltan para el próximo corte (fin de prueba, vencimiento o fin de la gracia); 0 = hoy. */
  daysLeft: number | null;
  /** El corte que cuenta `daysLeft`, en ISO. */
  until: string | null;
};

const daysUntil = (end: Date, now: Date) => Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));

/**
 * El estado comercial. «Pagado hasta» manda sobre la prueba: quien ya pagó
 * es cliente. Pero si la prueba sigue viva y el pago ya venció (registraron
 * un mes y luego le alargaron la prueba), vale lo que le dé más tiempo.
 */
export function billingState(b: BillingInput | null, now: Date = new Date()): BillingState {
  const none: BillingState = { kind: "none", restricted: false, daysLeft: null, until: null };
  if (!b || (!b.trialEndsAt && !b.paidUntil)) return none;
  const trialAlive = b.trialEndsAt !== null && b.trialEndsAt.getTime() > now.getTime();
  if (b.paidUntil && !(trialAlive && b.paidUntil.getTime() <= now.getTime())) {
    const paid = b.paidUntil;
    if (paid.getTime() > now.getTime()) {
      const days = daysUntil(paid, now);
      return { kind: days <= WARN_DAYS ? "due" : "paid", restricted: false, daysLeft: days, until: paid.toISOString() };
    }
    const graceEnd = new Date(paid.getTime() + Math.max(0, b.graceDays) * DAY_MS);
    if (graceEnd.getTime() > now.getTime()) {
      return { kind: "grace", restricted: false, daysLeft: daysUntil(graceEnd, now), until: graceEnd.toISOString() };
    }
    return { kind: "overdue", restricted: true, daysLeft: 0, until: graceEnd.toISOString() };
  }
  const end = b.trialEndsAt!;
  if (end.getTime() <= now.getTime()) return { kind: "trial_expired", restricted: true, daysLeft: 0, until: end.toISOString() };
  const days = daysUntil(end, now);
  return { kind: days <= WARN_DAYS ? "trial_ending" : "trial", restricted: false, daysLeft: days, until: end.toISOString() };
}

export const BILLING_LABEL: Record<BillingKind, string> = {
  none: "Sin cobro registrado",
  trial: "En prueba",
  trial_ending: "Prueba por terminar",
  trial_expired: "Prueba terminada",
  paid: "Al corriente",
  due: "Pago por vencer",
  grace: "En días de gracia",
  overdue: "Pago vencido",
};

/** Lo que ve el CLIENTE (nunca montos). `null` = no hay nada que decir. */
export function billingNoticeText(s: BillingState): string | null {
  const d = s.daysLeft ?? 0;
  const dias = d === 1 ? "1 día" : `${d} días`;
  switch (s.kind) {
    case "trial_ending":
      return d === 0 ? "Tu prueba gratis termina hoy." : `Tu prueba gratis termina en ${dias}.`;
    case "trial_expired":
      return "Tu prueba gratis terminó: la IA y las campañas están en pausa. Tus chats siguen llegando y puedes contestarlos.";
    case "due":
      return d === 0 ? "Tu plan vence hoy." : `Tu plan vence en ${dias}.`;
    case "grace":
      return `Tu pago está pendiente. Te quedan ${dias} antes de que se pausen la IA y las campañas.`;
    case "overdue":
      return "Tu pago está pendiente: la IA y las campañas están en pausa. Tus chats siguen llegando y puedes contestarlos.";
    default:
      return null;
  }
}

/** El motivo que queda en una campaña pausada o en el aviso de la IA. */
export function restrictionReason(kind: BillingKind): string {
  return kind === "trial_expired" ? "la prueba gratis terminó" : "el pago está pendiente";
}

/* ───────── Pagos y extras ───────── */

export const PAYMENT_KINDS = ["plan", "ai_reset", "extra_person", "extra_storage", "onboarding", "other"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const PAYMENT_LABEL: Record<PaymentKind, string> = {
  plan: "Mensualidad del plan",
  ai_reset: "Restablecer la IA del mes",
  extra_person: "Persona extra",
  extra_storage: "50 GB extra",
  onboarding: "Alta asistida",
  other: "Otro",
};

/** Precio sugerido en MXN (IVA incluido) de cada extra; el administrador lo puede cambiar al registrar. */
export const EXTRA_PRICE_MXN: Partial<Record<PaymentKind, number>> = {
  extra_person: 149,
  extra_storage: 99,
  onboarding: 1500,
};

/** «Restablecer la IA del mes» por plan (MXN, IVA incluido). */
export const AI_RESET_PRICE_MXN: Record<string, number> = { inicio: 99, esencial: 99, pro: 299, ultra: 899 };

export const EXTRA_STORAGE_GB = 50;

/**
 * Hasta cuándo queda pagado al registrar `months` mensualidades: desde el
 * «pagado hasta» si sigue vigente o venció hace menos de 60 días (el mes que
 * paga tarde es el mismo mes, no se regalan días), si no desde hoy. Meses de
 * calendario.
 */
export function extendPaidUntil(paidUntil: Date | null, months: number, now: Date = new Date()): Date {
  const from = paidUntil && paidUntil.getTime() > now.getTime() - 60 * DAY_MS ? paidUntil : now;
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // 31 de enero + 1 mes = último día de febrero, no 3 de marzo.
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}

/** El mes UTC «AAAA-MM» (el de los topes de IA). */
export function monthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** La IA extra que vale ESTE mes (la de otro mes ya no cuenta). */
export function activeAiBonus(bonusUsd: number | null, bonusMonth: string | null, now: Date = new Date()): number {
  if (!bonusUsd || bonusUsd <= 0 || bonusMonth !== monthKey(now)) return 0;
  return bonusUsd;
}
