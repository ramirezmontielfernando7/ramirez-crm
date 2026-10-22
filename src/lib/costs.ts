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
  /** `null` = el análisis del asistente usa los precios del modelo principal. */
  analysisInputUsdPerMtok: number | null;
  analysisOutputUsdPerMtok: number | null;
  embedUsdPerMtok: number;
  /** Unidades de la moneda local por 1 USD. `null` = sin tipo de cambio: solo USD. */
  usdToLocal: number | null;
  localCurrency: string;
  createdAt: string;
  createdByEmail: string | null;
};

export type PricingInput = {
  chatInputUsdPerMtok: number;
  chatOutputUsdPerMtok: number;
  judgeInputUsdPerMtok: number | null;
  judgeOutputUsdPerMtok: number | null;
  /** Ausente o `null` = el análisis usa el precio del principal. */
  analysisInputUsdPerMtok?: number | null;
  analysisOutputUsdPerMtok?: number | null;
  embedUsdPerMtok: number;
  /** Ausente o `null` = sin tipo de cambio (solo USD). */
  usdToLocal?: number | null;
  localCurrency: string;
  /** `YYYY-MM-DD` (UTC). Ausente = desde ahora. */
  validFrom?: string;
};

/** Las funciones que gastan IA (la fila `total` NO entra: es la suma de las de chat). */
// 038: el asistente interno (premium) se cobra con el precio del modelo principal.
export const COST_KINDS = ["agent", "lab", "judge", "writing", "assistant", "embed"] as const;
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

/** ¿Hay tipo de cambio capturado? Sin él todo se muestra solo en USD. */
export function hasExchangeRate(p: Pricing | null): p is Pricing & { usdToLocal: number } {
  return !!p && p.usdToLocal !== null;
}

/** USD con centavos; montos chicos con más decimales para que no se lean como cero. */
export function formatUsd(usd: number | null): string {
  if (usd === null) return "—";
  const digits = usd !== 0 && Math.abs(usd) < 1 ? 4 : 2;
  return `${new Intl.NumberFormat("es-MX", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(usd)} USD`.replace(/ /g, " ");
}

/** Un monto en USD convertido a la moneda local del precio vigente. */
export function formatLocal(usd: number | null, p: Pricing | null): string {
  if (usd === null || !p || p.usdToLocal === null) return "—";
  const local = usd * p.usdToLocal;
  const digits = local !== 0 && Math.abs(local) < 1 ? 4 : 2;
  return `${new Intl.NumberFormat("es-MX", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(local)} ${p.localCurrency}`.replace(/ /g, " ");
}

export const COST_KIND_LABEL: Record<CostKind, string> = {
  agent: "Agente (conversaciones reales)",
  lab: "Laboratorio",
  judge: "Juez del Laboratorio",
  writing: "Asistente de redacción",
  assistant: "Asistente interno",
  embed: "Embeddings (documentos)",
};

export const ESTIMATE_NOTE =
  "Estimado: tokens del mes × tus precios vigentes. Real: lo que reportó OpenRouter en cada llamada (desde que se activó, y solo si el proveedor lo manda). Proyección: el mayor de los dos, al ritmo de lo que va del mes.";

// ---------------------------------------------------------------------------
// Modelos: quién usa qué, precios sugeridos y calculadora de costo máximo.
// ---------------------------------------------------------------------------

/** Las cuatro funciones de modelo que configura el operador por variable de entorno. */
export const AI_ROLES = ["main", "judge", "analysis", "embed"] as const;
export type AiRole = (typeof AI_ROLES)[number];

export const AI_ROLE_LABEL: Record<AiRole, string> = {
  main: "Principal (agente, Laboratorio, redacción, asistente)",
  judge: "Juez del Laboratorio",
  analysis: "Análisis de conversaciones (asistente)",
  embed: "Embeddings (documentos)",
};

export const AI_ROLE_ENV: Record<AiRole, string> = {
  main: "OPENROUTER_MODEL",
  judge: "OPENROUTER_JUDGE_MODEL",
  analysis: "OPENROUTER_ANALYSIS_MODEL",
  embed: "EMBEDDINGS_MODEL",
};

export type PriceSuggestion = { inputUsdPerMtok: number; outputUsdPerMtok: number; note: string };

/**
 * Precios de referencia (USD por millón de tokens) de modelos que ya usamos,
 * para proveedores que NO publican precios por API (OpenAI, Bedrock). Son
 * una ayuda para capturar a mano, no una fuente de verdad: confirma contra
 * la factura del proveedor.
 */
const KNOWN_PRICES: { match: RegExp; price: PriceSuggestion }[] = [
  { match: /claude-haiku-5[-.]5/i, price: { inputUsdPerMtok: 0.1, outputUsdPerMtok: 0.5, note: "Claude Haiku 5.5" } },
  { match: /claude-sonnet-5[-.]5/i, price: { inputUsdPerMtok: 2, outputUsdPerMtok: 10, note: "Claude Sonnet 5.5" } },
  { match: /gpt-6-luna/i, price: { inputUsdPerMtok: 0.1, outputUsdPerMtok: 0.5, note: "GPT-6 Luna" } },
  { match: /gpt-6-sol/i, price: { inputUsdPerMtok: 2, outputUsdPerMtok: 10, note: "GPT-6 Sol (precio inferido)" } },
];

/** El precio de referencia de un modelo conocido, o `null`. */
export function suggestedPriceFor(modelId: string | null): PriceSuggestion | null {
  if (!modelId) return null;
  return KNOWN_PRICES.find((k) => k.match.test(modelId))?.price ?? null;
}

/**
 * Lee de la respuesta de `GET {OpenRouter}/v1/models` el precio de un modelo.
 * OpenRouter lo da en USD POR TOKEN (texto); aquí sale por millón.
 */
export function parseOpenRouterPrice(json: unknown, modelId: string): PriceSuggestion | null {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  const m = data.find((x) => (x as { id?: unknown })?.id === modelId) as { pricing?: { prompt?: unknown; completion?: unknown } } | undefined;
  const inp = Number(m?.pricing?.prompt);
  const out = Number(m?.pricing?.completion);
  if (!m || !Number.isFinite(inp) || !Number.isFinite(out) || inp < 0 || out < 0) return null;
  const round = (n: number) => Math.round(n * 1e6 * 1e6) / 1e6;
  return { inputUsdPerMtok: round(inp), outputUsdPerMtok: round(out), note: "OpenRouter" };
}

/** Los topes de una organización que mueven el costo. `null` = sin tope. */
export type CapacityLimits = {
  aiTurns: number | null;
  aiTokens: number | null;
  assistantTokens: number | null;
  embedTokens: number | null;
};

export type CapacityLine = {
  organizationId: string;
  name: string;
  status: string;
  limits: CapacityLimits;
};

export type CapacityCost = {
  chatUsd: number;
  assistantUsd: number;
  embedUsd: number;
  /** `null` = sin tope de tokens de chat: el máximo no tiene techo. */
  totalUsd: number | null;
  /** Falta el tope de tokens de chat (o de embeddings con precio): el total es solo lo que sí tiene tope. */
  unbounded: boolean;
};

/** USD por millón de una mezcla `inputShare` entrada / resto salida. */
const blend = (inp: number, out: number, inputShare: number) => inp * inputShare + out * (1 - inputShare);

/**
 * Costo MÁXIMO del mes si la organización gastara todo su tope, con estos
 * precios y esta proporción de tokens de entrada (0–1).
 * - El tope de tokens de IA es el total (el asistente cuenta dentro de él): lo
 *   del asistente se cobra al más caro entre principal y análisis, y el resto
 *   al más caro entre principal y juez (peor caso).
 * - Sin tope propio del asistente, el asistente no responde: 0.
 * - Embeddings: tope de tokens × su precio (todo es entrada).
 */
export function capacityCost(limits: CapacityLimits, p: Pricing, inputShare: number): CapacityCost {
  const share = Math.min(1, Math.max(0, inputShare));
  const main = blend(p.chatInputUsdPerMtok, p.chatOutputUsdPerMtok, share);
  const judge = blend(p.judgeInputUsdPerMtok ?? p.chatInputUsdPerMtok, p.judgeOutputUsdPerMtok ?? p.chatOutputUsdPerMtok, share);
  const analysis = blend(p.analysisInputUsdPerMtok ?? p.chatInputUsdPerMtok, p.analysisOutputUsdPerMtok ?? p.chatOutputUsdPerMtok, share);
  const chatPrice = Math.max(main, judge);
  const assistantPrice = Math.max(main, analysis);

  const total = limits.aiTokens;
  const assistantCap = limits.assistantTokens === null ? 0 : total === null ? limits.assistantTokens : Math.min(limits.assistantTokens, total);
  const assistantUsd = (assistantCap * assistantPrice) / M;
  const embedUsd = ((limits.embedTokens ?? 0) * p.embedUsdPerMtok) / M;
  if (total === null) {
    return { chatUsd: 0, assistantUsd, embedUsd, totalUsd: null, unbounded: true };
  }
  const chatUsd = (Math.max(0, total - assistantCap) * chatPrice) / M;
  const unbounded = limits.embedTokens === null && p.embedUsdPerMtok > 0;
  return { chatUsd, assistantUsd, embedUsd, totalUsd: chatUsd + assistantUsd + embedUsd, unbounded };
}
