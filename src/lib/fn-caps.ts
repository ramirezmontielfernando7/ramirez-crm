/**
 * 0072 — Reparto de la bolsa de IA por función (agentes, creador, asistente).
 * Cada tope se escribe en dólares, millones de tokens o % del total, y se
 * guarda TAL CUAL se escribió: el porcentaje sigue al total si éste cambia.
 * Reglas puras (sin servidor ni React).
 */
export const CAP_UNITS = ["pct", "usd", "mtok"] as const;
export type CapUnit = (typeof CAP_UNITS)[number];

export const CAP_UNIT_LABEL: Record<CapUnit, string> = { pct: "% del total", usd: "Dólares", mtok: "Millones de tokens" };

/** Un tope por función: la unidad, lo escrito y los dólares ya convertidos (solo `usd` y `mtok`). */
export type FnCapValue = { unit: CapUnit; value: number | null; usd: number | null };

/** Los dólares que vale un tope. `%` sin total no vale nada (`null`: no se puede resolver). */
export function capUsd(cap: FnCapValue, poolUsd: number | null): number | null {
  if (cap.value === null) return null;
  if (cap.unit === "pct") return poolUsd === null ? null : (poolUsd * cap.value) / 100;
  return cap.usd;
}

export type CapsCheck = { ok: true; repartidoUsd: number; pct: number | null } | { ok: false; code: "pct_sin_total" | "suma_excede"; message: string; pct: number | null };

/** Lo repartido entre funciones no puede pasar del total; un % necesita un total. */
export function checkCaps(caps: FnCapValue[], poolUsd: number | null): CapsCheck {
  const activos = caps.filter((c) => c.value !== null);
  if (activos.some((c) => c.unit === "pct") && poolUsd === null) {
    return { ok: false, code: "pct_sin_total", pct: null, message: "Para repartir en porcentaje primero fija el tope mensual de IA (el total)." };
  }
  const repartido = activos.reduce((n, c) => n + (capUsd(c, poolUsd) ?? 0), 0);
  const pct = poolUsd && poolUsd > 0 ? Math.round((repartido / poolUsd) * 1000) / 10 : null;
  if (poolUsd !== null && repartido > poolUsd + 1e-9) {
    return { ok: false, code: "suma_excede", pct, message: `Lo repartido suma ${pct === null ? "más" : `${Math.round(pct)} %`} del total: bájalo para guardar.` };
  }
  return { ok: true, repartidoUsd: repartido, pct };
}
