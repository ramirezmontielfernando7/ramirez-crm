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

export type EffectiveLimits = {
  planKey: PlanKey;
  aiTurns: Limit;
  aiTokens: Limit;
  embedTokens: Limit;
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

export const ALERT_METRICS = ["ai_tokens", "ai_turns", "embed_tokens", "storage", "members", "modules"] as const;
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
};

/**
 * Los umbrales que este uso ya cruzó contra su tope. Sin tope (o tope 0, que
 * no deja usar nada y no tiene «80 %»): ninguno.
 */
export function crossedThresholds(used: number, limit: number | null): AlertThreshold[] {
  if (limit === null || limit <= 0) return [];
  return ALERT_THRESHOLDS.filter((t) => used * 100 >= limit * t);
}

/** El texto del aviso para el Propietario. */
export function alertText(metric: AlertMetric, threshold: AlertThreshold): string {
  return threshold >= 100
    ? `Tu organización llegó al tope de ${ALERT_METRIC_LABEL[metric]}.`
    : `Tu organización va en el ${threshold} % del tope de ${ALERT_METRIC_LABEL[metric]}.`;
}

/** Mensajes de rechazo cuando un tope impide crecer. */
export const LIMIT_MESSAGES = {
  storage:
    "Tu organización llegó a su tope de almacenamiento: este archivo no se puede subir. Borra archivos que ya no uses o pide más espacio al administrador.",
  members: "Tu organización llegó a su tope de personas. Pide al administrador que lo amplíe.",
  modules: "Esta organización llegó a su tope de módulos activos: apaga otro antes de encender este.",
} as const;
