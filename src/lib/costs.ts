/**
 * 036 (PR 3b) — Reglas puras del panel de costos de la plataforma.
 *
 * - **Estimado**: tokens del mes × los precios que captura el administrador
 *   (USD por millón de tokens: entrada y salida del modelo principal, del juez
 *   y de embeddings). Los tokens del mes se guardan sumados por función, así
 *   que el estimado usa los precios VIGENTES al cierre del periodo (o ahora,
 *   si es el mes en curso).
 * - **Real**: lo que reportó OpenRouter (`usage.cost`, créditos = USD) en cada
 *   llamada, sumado en `ai_usage.cost_usd`. Solo existe desde que se desplegó
 *   este PR y solo si el proveedor lo manda (el contenedor local de
 *   embeddings, por ejemplo, no).
 * - **Proyección**: lo gastado ÷ la fracción del mes transcurrida (UTC).
 * - La moneda local sale del tipo de cambio del precio vigente.
 */

export type Pricing = {
  id: string;
  /** ISO: desde cuándo rige. */
  validFrom: string;
  chatInputUsdPerMtok: number;
  chatOutputUsdPerMtok: number;
  /** `null` = el juez usa los precios del modelo principal. */
  judgeInputUsdPerMtok: number | null;
  judgeOutputUsdPerMtok: number | null;
  embedUsdPerMtok: number;
  /** Unidades de la moneda local por 1 USD. */
  usdToLocal: number;
  localCurrency: string;
  createdAt: string;
  createdByEmail: string | null;
};

export type PricingInput = {
  chatInputUsdPerMtok: number;
  chatOutputUsdPerMtok: number;
  judgeInputUsdPerMtok: number | null;
  judgeOutputUsdPerMtok: number | null;
  embedUsdPerMtok: number;
  usdToLocal: number;
  localCurrency: string;
  /** `YYYY-MM-DD` (UTC). Ausente = desde ahora. */
  validFrom?: string;
};

/** Las funciones que gastan IA (la fila `total` NO entra: es la suma de las de chat). */
export const COST_KINDS = ["agent", "lab", "judge", "writing", "embed"] as const;
export type CostKind = (typeof COST_KINDS)[number];

export type KindUsage = { kind: string; promptTokens: number; completionTokens: number; costUsd: number };

export type KindCost = { kind: CostKind; tokens: number; estimatedUsd: number | null; realUsd: number };

const M = 1_000_000;

export function isCostKind(k: string): k is CostKind {
  return (COST_KINDS as readonly string[]).includes(k);
}

/** El costo estimado de UNA función con estos precios (`null` sin precios). */
export function estimateKindUsd(kind: CostKind, prompt: number, completion: number, p: Pricing | null): number | null {
  if (!p) return null;
  if (kind === "embed") return (prompt * p.embedUsdPerMtok) / M;
  const judge = kind === "judge";
  const inp = judge ? (p.judgeInputUsdPerMtok ?? p.chatInputUsdPerMtok) : p.chatInputUsdPerMtok;
  const out = judge ? (p.judgeOutputUsdPerMtok ?? p.chatOutputUsdPerMtok) : p.chatOutputUsdPerMtok;
  return (prompt * inp + completion * out) / M;
}

/** El desglose por función (en el orden de `COST_KINDS`; solo las que tuvieron consumo). */
export function costByKind(rows: KindUsage[], p: Pricing | null): KindCost[] {
  const out: KindCost[] = [];
  for (const kind of COST_KINDS) {
    const r = rows.find((x) => x.kind === kind);
    if (!r) continue;
    out.push({
      kind,
      tokens: r.promptTokens + r.completionTokens,
      estimatedUsd: estimateKindUsd(kind, r.promptTokens, r.completionTokens, p),
      realUsd: r.costUsd,
    });
  }
  return out;
}

export type CostTotals = { estimatedUsd: number | null; realUsd: number | null };

/** Estimado y real de un conjunto de funciones. Real `null` = el proveedor no reportó nada. */
export function sumCosts(kinds: KindCost[], hasPricing: boolean): CostTotals {
  let est = 0;
  let real = 0;
  for (const k of kinds) {
    est += k.estimatedUsd ?? 0;
    real += k.realUsd;
  }
  return { estimatedUsd: hasPricing ? est : null, realUsd: real > 0 ? real : null };
}

/** El costo del mes de UNA organización (renglón del panel). */
export type OrgCostLine = {
  organizationId: string;
  name: string;
  status: string;
  estimatedUsd: number | null;
  realUsd: number | null;
  /** Proyección a fin de mes (ver `projectionBase`). */
  projectedUsd: number | null;
  byKind: KindCost[];
};

export type CostReport = {
  period: string;
  /** Fracción del mes transcurrida (0–1), para explicar la proyección. */
  elapsed: number;
  /** El precio con el que se estimó el periodo (`null` = aún no hay precios capturados). */
  pricing: Pricing | null;
  rows: OrgCostLine[];
  totals: {
    estimatedUsd: number | null;
    realUsd: number | null;
    projectedUsd: number | null;
  };
};

/** Inicio y fin (exclusivo) de un periodo `YYYY-MM-01` en UTC. */
export function periodBounds(period: string): { start: Date; end: Date } {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

/** Qué tanto del mes ya pasó (0–1). Al menos un día, para no proyectar de una hora. */
export function monthElapsed(period: string, now = new Date()): number {
  const { start, end } = periodBounds(period);
  const total = end.getTime() - start.getTime();
  if (now.getTime() >= end.getTime()) return 1;
  const elapsed = Math.max(now.getTime() - start.getTime(), 24 * 3600 * 1000);
  return Math.min(1, elapsed / total);
}

/** Proyección a fin de mes: lo gastado al ritmo de lo que va del mes. */
export function projectMonth(spentUsd: number | null, period: string, now = new Date()): number | null {
  if (spentUsd === null) return null;
  return spentUsd / monthElapsed(period, now);
}

/**
 * Sobre qué se proyecta: el MAYOR entre estimado y real. El real puede cubrir
 * solo parte del mes (las llamadas de antes del despliegue, o de un proveedor
 * que no reporta, no traen costo), y el estimado depende de precios
 * capturados a mano: tomar el mayor evita quedarse corto al presupuestar.
 */
export function projectionBase(t: CostTotals): number | null {
  if (t.estimatedUsd === null && t.realUsd === null) return null;
  return Math.max(t.estimatedUsd ?? 0, t.realUsd ?? 0);
}

/** El precio que rige en `at`: el de `validFrom` más reciente que no sea futuro. */
export function pricingAt(history: Pricing[], at: Date): Pricing | null {
  let best: Pricing | null = null;
  for (const p of history) {
    const t = new Date(p.validFrom).getTime();
    if (t > at.getTime()) continue;
    if (!best || t > new Date(best.validFrom).getTime()) best = p;
  }
  return best;
}

/** El momento con el que se escoge el precio de un periodo: ahora o, si ya cerró, su último instante. */
export function pricingMomentFor(period: string, now = new Date()): Date {
  const { end } = periodBounds(period);
  return now.getTime() < end.getTime() ? now : new Date(end.getTime() - 1);
}

/** USD con centavos; montos chicos con más decimales para que no se lean como cero. */
export function formatUsd(usd: number | null): string {
  if (usd === null) return "—";
  const digits = usd !== 0 && Math.abs(usd) < 1 ? 4 : 2;
  return `${new Intl.NumberFormat("es-MX", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(usd)} USD`.replace(/ /g, " ");
}

/** Un monto en USD convertido a la moneda local del precio vigente. */
export function formatLocal(usd: number | null, p: Pricing | null): string {
  if (usd === null || !p) return "—";
  const local = usd * p.usdToLocal;
  const digits = local !== 0 && Math.abs(local) < 1 ? 4 : 2;
  return `${new Intl.NumberFormat("es-MX", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(local)} ${p.localCurrency}`.replace(/ /g, " ");
}

export const COST_KIND_LABEL: Record<CostKind, string> = {
  agent: "Agente (conversaciones reales)",
  lab: "Laboratorio",
  judge: "Juez del Laboratorio",
  writing: "Asistente de redacción",
  embed: "Embeddings (documentos)",
};

export const ESTIMATE_NOTE =
  "Estimado: tokens del mes × tus precios vigentes. Real: lo que reportó OpenRouter en cada llamada (desde que se activó, y solo si el proveedor lo manda). Proyección: el mayor de los dos, al ritmo de lo que va del mes.";
