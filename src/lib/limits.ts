/**
 * 036 (PR 3a) — Límites y avisos de consumo: contrato y reglas puras (sin
 * servidor ni React). La puerta es `src/server/limits/`.
 */

/** De dónde sale un tope: propio de la organización, del entorno, o no hay. */
export type LimitSource = "org" | "env" | "none";
export type Limit = { value: number | null; source: LimitSource };

export const STORAGE_MODES = ["warn", "block_uploads"] as const;
export type StorageMode = (typeof STORAGE_MODES)[number];

export const STORAGE_MODE_LABEL: Record<StorageMode, string> = {
  warn: "Solo avisar",
  block_uploads: "Bloquear subidas manuales",
};

/** Hoy solo hay un plan: «Personalizado». Los planes base llegan después. */
export const PLAN_KEYS = ["custom"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export const PLAN_LABEL: Record<PlanKey, string> = { custom: "Personalizado" };

/**
 * 038 (PR 1) — Cómo ve el CLIENTE su consumo de IA (Uso y plan, avisos y el
 * asistente). La plataforma siempre ve todo, dólares incluidos; el cliente
 * nunca ve dólares.
 */
export const USAGE_VISIBILITIES = ["percent", "status", "tokens"] as const;
export type UsageVisibility = (typeof USAGE_VISIBILITIES)[number];
export const DEFAULT_USAGE_VISIBILITY: UsageVisibility = "percent";
export const USAGE_VISIBILITY_LABEL: Record<UsageVisibility, string> = {
  percent: "Porcentaje del tope",
  status: "Solo «Disponible» / «Agotado»",
  tokens: "Tokens (cifras reales)",
};

export function isUsageVisibility(v: unknown): v is UsageVisibility {
  return typeof v === "string" && (USAGE_VISIBILITIES as readonly string[]).includes(v);
}

export type EffectiveLimits = {
  planKey: PlanKey;
  aiTurns: Limit;
  aiTokens: Limit;
  embedTokens: Limit;
  /** 038 — Tope propio del asistente interno (tokens al mes). Sin tope = el asistente no responde. */
  assistantTokens: Limit;
  /** 038 — Cómo ve el cliente su consumo de IA. */
  usageVisibility: UsageVisibility;
  members: Limit;
  storageBytes: Limit;
  storageMode: StorageMode;
  modules: Limit;
  kbMaxDocuments: Limit;
  kbMaxChunks: Limit;
  kbMaxFileBytes: Limit;
};

/** Lo que el administrador puede cambiar: `undefined` = no tocar; `null` = heredar. */
export type LimitsPatch = {
  planKey?: PlanKey;
  aiTurns?: number | null;
  aiTokens?: number | null;
  embedTokens?: number | null;
  assistantTokens?: number | null;
  usageVisibility?: UsageVisibility;
  members?: number | null;
  storageBytes?: number | null;
  storageMode?: StorageMode;
  modules?: number | null;
  kbMaxDocuments?: number | null;
  kbMaxChunks?: number | null;
  kbMaxFileBytes?: number | null;
};

/** Un tope: el propio si lo hay; si no, el del entorno; si no, sin tope. */
export function resolveLimit(own: number | null | undefined, env: number | null | undefined): Limit {
  if (own !== null && own !== undefined) return { value: own, source: "org" };
  if (env !== null && env !== undefined) return { value: env, source: "env" };
  return { value: null, source: "none" };
}

/* ───────── Avisos ───────── */

export const ALERT_METRICS = ["ai_tokens", "ai_turns", "embed_tokens", "storage", "members", "modules", "assistant_tokens"] as const;
export type AlertMetric = (typeof ALERT_METRICS)[number];
export const ALERT_THRESHOLDS = [80, 100] as const;
export type AlertThreshold = (typeof ALERT_THRESHOLDS)[number];

export const ALERT_METRIC_LABEL: Record<AlertMetric, string> = {
  ai_tokens: "tokens de IA del mes",
  ai_turns: "turnos de IA del mes",
  embed_tokens: "tokens de embeddings del mes",
  storage: "almacenamiento (aprox.)",
  members: "personas del equipo",
  modules: "módulos activos",
  assistant_tokens: "tokens del asistente interno del mes",
};

/** 038 — Las medidas de IA: su aviso al cliente sigue su visibilidad. */
export const AI_ALERT_METRICS: readonly AlertMetric[] = ["ai_tokens", "ai_turns", "embed_tokens", "assistant_tokens"];

/** 038 — Cómo se nombra cada medida de IA cuando el cliente no ve tokens. */
const AI_METRIC_PLAIN: Partial<Record<AlertMetric, string>> = {
  ai_tokens: "IA del mes",
  ai_turns: "IA del mes",
  embed_tokens: "IA de los documentos del agente",
  assistant_tokens: "crédito del asistente interno",
};

/**
 * Los umbrales que este uso ya cruzó contra su tope. Sin tope (o tope 0, que
 * no deja usar nada y no tiene «80 %»): ninguno.
 */
export function crossedThresholds(used: number, limit: number | null): AlertThreshold[] {
  if (limit === null || limit <= 0) return [];
  return ALERT_THRESHOLDS.filter((t) => used * 100 >= limit * t);
}

/**
 * El texto del aviso para el Propietario. 038: en las medidas de IA sigue la
 * visibilidad de la organización — sin la palabra «tokens» salvo en `tokens`,
 * y sin número en `status` (solo «queda poco» / «se agotó»).
 */
export function alertText(
  metric: AlertMetric,
  threshold: AlertThreshold,
  visibility: UsageVisibility = "tokens"
): string {
  const plain = AI_METRIC_PLAIN[metric];
  if (!plain || visibility === "tokens") {
    return threshold >= 100
      ? `Tu organización llegó al tope de ${ALERT_METRIC_LABEL[metric]}.`
      : `Tu organización va en el ${threshold} % del tope de ${ALERT_METRIC_LABEL[metric]}.`;
  }
  if (visibility === "status") {
    return threshold >= 100 ? `Tu organización agotó su ${plain}.` : `A tu organización le queda poco de su ${plain}.`;
  }
  return threshold >= 100
    ? `Tu organización agotó su ${plain}.`
    : `Tu organización va en el ${threshold} % de su ${plain}.`;
}

/** Mensajes de rechazo cuando un tope impide crecer. */
export const LIMIT_MESSAGES = {
  storage:
    "Tu organización llegó a su tope de almacenamiento: este archivo no se puede subir. Borra archivos que ya no uses o pide más espacio al administrador.",
  members: "Tu organización llegó a su tope de personas. Pide al administrador que lo amplíe.",
  modules: "Esta organización llegó a su tope de módulos activos: apaga otro antes de encender este.",
} as const;
