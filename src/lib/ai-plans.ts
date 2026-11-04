/**
 * 0070 — Reglas puras de «IA: modelos y costos»: el costo aproximado de cada
 * función, la equivalencia dólares ↔ millones de tokens y el ritmo de gasto
 * contra los créditos. Solo números de referencia (todo dice «aprox.»).
 */

export type Price = { inputUsdPerMtok: number; outputUsdPerMtok: number };

/** Lo típico de una llamada de cada función (tokens de entrada y de salida). */
export const FUNCTION_PROFILE = {
  /** Una respuesta del agente: prompt, conocimiento e historial; respuesta corta. */
  agent: { input: 4_000, output: 250, per: 1_000, unit: "1,000 respuestas" },
  /** Una sesión del creador de agentes (varias vueltas). */
  creator: { input: 60_000, output: 6_000, per: 1, unit: "sesión" },
  /** Una pregunta al asistente (consultas y respuesta). */
  assistant: { input: 25_000, output: 1_500, per: 1, unit: "pregunta" },
} as const;

export type ProfileKey = keyof typeof FUNCTION_PROFILE;

/** Costo aproximado de `per` llamadas típicas de esa función. */
export function functionCost(fn: ProfileKey, price: Price | null): number | null {
  if (!price) return null;
  const p = FUNCTION_PROFILE[fn];
  return ((p.input * price.inputUsdPerMtok + p.output * price.outputUsdPerMtok) / 1_000_000) * p.per;
}

/** Proporción de tokens de entrada en el uso real (los prompts pesan más que las respuestas). */
export const INPUT_SHARE = 0.9;

/** Precio mezclado por millón de tokens (entrada y salida en la proporción típica). */
export function blendedUsdPerMtok(price: Price): number {
  return INPUT_SHARE * price.inputUsdPerMtok + (1 - INPUT_SHARE) * price.outputUsdPerMtok;
}

/** Cuántos millones de tokens alcanza un monto en dólares con ese precio. */
export function usdToMtok(usd: number, price: Price | null): number | null {
  if (!price) return null;
  const b = blendedUsdPerMtok(price);
  return b > 0 ? usd / b : null;
}

/** Cuántos dólares son unos millones de tokens con ese precio. */
export function mtokToUsd(mtok: number, price: Price | null): number | null {
  if (!price) return null;
  return mtok * blendedUsdPerMtok(price);
}

export function formatMtok(mtok: number | null): string {
  if (mtok === null || !Number.isFinite(mtok)) return "—";
  if (mtok >= 100) return `${Math.round(mtok)} M tokens`;
  if (mtok >= 10) return `${mtok.toFixed(1).replace(/\.0$/, "")} M tokens`;
  return `${mtok.toFixed(2).replace(/0$/, "").replace(/\.0$/, "")} M tokens`;
}

export function formatUsd2(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return "—";
  return `${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

/** Fracción transcurrida del mes (UTC) de `now`, entre 0 y 1. */
export function monthFraction(now: Date): number {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}

export type CreditsPace = {
  /** Créditos que quedan (créditos − gasto desde que empezaron). */
  remainingUsd: number | null;
  /** Hasta qué mes alcanzan al ritmo del presupuesto (ISO 'YYYY-MM-01'). */
  lastsUntil: string | null;
  /** Lo gastado este mes contra el presupuesto (0..). */
  ratio: number | null;
  /** «Vas bien» si la proyección del mes cabe en el presupuesto. */
  tone: "ok" | "warning" | "danger" | null;
};

/**
 * El ritmo contra los créditos. La proyección del mes es lo gastado ÷ la
 * fracción del mes; «danger» si ya se pasó del presupuesto, «warning» si la
 * proyección se pasa.
 */
export function creditsPace(input: {
  budgetUsd: number | null;
  creditsUsd: number | null;
  spentSinceCredits: number | null;
  spentThisMonth: number;
  now: Date;
}): CreditsPace {
  const remainingUsd = input.creditsUsd === null ? null : Math.max(0, input.creditsUsd - (input.spentSinceCredits ?? 0));
  let lastsUntil: string | null = null;
  if (remainingUsd !== null && input.budgetUsd && input.budgetUsd > 0) {
    const months = Math.floor(remainingUsd / input.budgetUsd);
    const d = new Date(Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth() + months, 1));
    lastsUntil = d.toISOString().slice(0, 10);
  }
  if (!input.budgetUsd || input.budgetUsd <= 0) return { remainingUsd, lastsUntil, ratio: null, tone: null };
  const ratio = input.spentThisMonth / input.budgetUsd;
  const frac = Math.max(monthFraction(input.now), 1 / 31);
  const projected = input.spentThisMonth / frac;
  const tone = ratio >= 1 ? "danger" : projected > input.budgetUsd ? "warning" : "ok";
  return { remainingUsd, lastsUntil, ratio, tone };
}

/** «octubre de 2028» desde 'YYYY-MM-01'. */
export function monthName(iso: string | null): string {
  if (!iso) return "—";
  const [y, m] = iso.split("-").map(Number);
  if (!y || !m) return iso;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
}
