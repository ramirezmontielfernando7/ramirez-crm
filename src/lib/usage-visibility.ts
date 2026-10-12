/**
 * 038 (PR 1) — Lo que el CLIENTE ve de su consumo de IA, según la visibilidad
 * que fijó el administrador de plataforma (`organization_plan.usage_visibility`):
 *
 * - `percent` (por defecto): porcentaje del tope, sin tokens ni turnos.
 * - `status`: solo «Disponible» / «Agotado», sin ningún número.
 * - `tokens`: las cifras reales (tokens y turnos), si el administrador lo habilita.
 *
 * El cliente nunca ve dólares. La proyección se hace en el SERVIDOR: lo que no
 * se debe ver no viaja en el JSON. Puro (sin servidor ni React).
 */
import type { UsageVisibility } from "@/lib/limits";
import { meterTone, type Meter } from "@/lib/usage";

export type GaugeState = "available" | "near" | "exhausted";

export const GAUGE_STATE_LABEL: Record<GaugeState, string> = {
  available: "Disponible",
  near: "Queda poco",
  exhausted: "Agotado",
};

/** Una medida de IA contra su tope, ya recortada a lo que el cliente puede ver. */
export type Gauge = {
  state: GaugeState;
  /** Porcentaje usado (redondeado); `null` sin tope o con visibilidad `status`. */
  percent: number | null;
  /** Solo con visibilidad `tokens`: lo usado y el tope (null = sin tope). */
  used?: number;
  limit?: number | null;
};

/** Sin tope: disponible. Tope 0: agotado. Desde 80 %: queda poco. */
export function gaugeState(used: number, limit: number | null): GaugeState {
  if (limit === null) return "available";
  if (used >= limit) return "exhausted";
  return used * 100 >= limit * 80 ? "near" : "available";
}

export function projectGauge(visibility: UsageVisibility, used: number, limit: number | null): Gauge {
  const state = gaugeState(used, limit);
  if (visibility === "status") return { state: state === "near" ? "available" : state, percent: null };
  const percent = limit === null ? null : limit > 0 ? Math.round((used / limit) * 100) : 100;
  return visibility === "tokens" ? { state, percent, used, limit } : { state, percent };
}

const RANK: Record<GaugeState, number> = { available: 0, near: 1, exhausted: 2 };

/** De dos medidas (turnos y tokens), la que frena primero. */
export function worstGauge(a: Gauge, b: Gauge): Gauge {
  if (RANK[b.state] !== RANK[a.state]) return RANK[b.state] > RANK[a.state] ? b : a;
  return (b.percent ?? -1) > (a.percent ?? -1) ? b : a;
}

/**
 * El medidor de una medida para `percent` y `status` (con `tokens` la
 * pantalla usa los medidores de siempre, con las cifras).
 */
export function gaugeMeter(g: Gauge): Meter {
  if (g.percent === null) {
    const text = GAUGE_STATE_LABEL[g.state];
    return { text, ratio: null, tone: g.state === "exhausted" ? "danger" : "normal", detail: text };
  }
  const ratio = g.percent / 100;
  const text = g.state === "exhausted" ? `${GAUGE_STATE_LABEL.exhausted} (100 %)` : `${g.percent} % del tope`;
  return { text, ratio, tone: meterTone(ratio), detail: text };
}

/**
 * Una línea de «¿quién consume más?»: su parte del total (0–1) y, solo con
 * `tokens`, sus cifras. Con `status` no hay desglose (devuelve `null`).
 */
export type ShareLine<K> = { key: K; share: number; tokens?: number; turns?: number };

export function projectShares<K>(
  visibility: UsageVisibility,
  rows: { key: K; tokens: number; turns: number }[]
): ShareLine<K>[] | null {
  if (visibility === "status") return null;
  const total = rows.reduce((s, r) => s + r.tokens, 0);
  return rows.map((r) => ({
    key: r.key,
    share: total > 0 ? r.tokens / total : 0,
    ...(visibility === "tokens" ? { tokens: r.tokens, turns: r.turns } : {}),
  }));
}
