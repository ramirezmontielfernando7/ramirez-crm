import type { PlanKey } from "@/lib/limits";
import type { CatalogScope } from "@/lib/plan-catalog";

/**
 * Cuándo se le avisa al Propietario que su IA se acaba y se le ofrece mejorar
 * el plan. Reglas PURAS (sin red ni base): el servidor calcula el ritmo
 * (`src/server/usage/pace.ts`) y el navegador decide si ya toca mostrar la
 * ventana (`UsagePrompt`). Nunca dólares: solo porcentajes y fechas.
 */

const DAY_MS = 86_400_000;

export type PaceInfo = {
  /** Cuánto lleva usado de la IA del mes (0–100+). */
  percent: number;
  /** A este ritmo, dónde terminaría el mes (puede pasar de 100). */
  projectedPercent: number;
  /** Cuándo llegaría al 100 % a este ritmo; `null` si no llega antes de renovar. */
  hitDate: string | null;
  /** Primer día del mes siguiente (cuando se renueva). */
  resetDate: string;
  daysLeft: number;
  exhausted: boolean;
};

/** El ritmo de gasto del mes. `spent` y `limit` en la misma unidad; `limit > 0`. */
export function computePace(spent: number, limit: number, now: Date): PaceInfo {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const elapsed = Math.max(now.getTime() - start, DAY_MS / 24); // al menos una hora, para no dividir entre ~0
  const frac = Math.min(1, elapsed / (end - start));
  const percent = Math.max(0, (spent / limit) * 100);
  const projectedPercent = percent / frac;
  const hitMs = percent > 0 ? start + (100 / percent) * elapsed : null;
  return {
    percent,
    projectedPercent,
    hitDate: hitMs !== null && hitMs < end ? new Date(hitMs).toISOString() : null,
    resetDate: new Date(end).toISOString(),
    daysLeft: Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS)),
    exhausted: percent >= 100,
  };
}

export type PromptKind = "pace" | "limit";

/**
 * Qué ventana toca: «limit» al llegar al 100 %; «pace» al pasar del 80 % o si,
 * con la mitad usada y más de 5 días por delante, el ritmo ya rebasa el tope.
 */
export function promptKind(p: PaceInfo): PromptKind | null {
  if (p.exhausted) return "limit";
  if (p.daysLeft < 1) return null;
  if (p.percent >= 80) return "pace";
  if (p.percent >= 50 && p.projectedPercent >= 100 && p.daysLeft > 5) return "pace";
  return null;
}

/** El plan al que conviene subir (`null` si ya está en el más alto). */
export function nextPlan(current: PlanKey): CatalogScope | null {
  if (current === "inicio") return "esencial";
  if (current === "esencial") return "pro";
  if (current === "pro") return "ultra";
  if (current === "ultra") return null;
  return "pro"; // «personalizado»: se le muestran los tres, con Pro de entrada
}

export type PromptMemory = {
  /** Cuándo se mostró la última vez cada ventana (ms). */
  shown?: Partial<Record<PromptKind, number>>;
  /** «Recordármelo después»: no volver a mostrarla antes de esta marca (ms). */
  snoozedUntil?: Partial<Record<PromptKind, number>>;
  /** Mes al que corresponde lo recordado (`AAAA-MM`): otro mes, memoria nueva. */
  month?: string;
};

const PACE_EVERY_MS = 7 * DAY_MS;
const LIMIT_EVERY_MS = DAY_MS;
const SNOOZE_MS = 3 * DAY_MS;

const monthOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** ¿Toca mostrar esta ventana ahora? «pace» una vez por semana, «limit» una por día. */
export function shouldShowPrompt(kind: PromptKind, memory: PromptMemory, now: Date): boolean {
  const mem = memory.month === monthOf(now) ? memory : {};
  const t = now.getTime();
  if ((mem.snoozedUntil?.[kind] ?? 0) > t) return false;
  const last = mem.shown?.[kind];
  if (last === undefined) return true;
  return t - last >= (kind === "limit" ? LIMIT_EVERY_MS : PACE_EVERY_MS);
}

export function markShown(kind: PromptKind, memory: PromptMemory, now: Date, snooze = false): PromptMemory {
  const base = memory.month === monthOf(now) ? memory : {};
  const t = now.getTime();
  return {
    month: monthOf(now),
    shown: { ...base.shown, [kind]: t },
    snoozedUntil: snooze ? { ...base.snoozedUntil, [kind]: t + SNOOZE_MS } : base.snoozedUntil,
  };
}

/** «22 de noviembre» (UTC, como el resto de fechas de consumo). */
export function dayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "long", timeZone: "UTC" });
}
