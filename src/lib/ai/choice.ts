import type { Env } from "@/lib/env";

/**
 * Qué modelo y con cuánto esfuerzo responde cada FUNCIÓN de Dashfort. Solo
 * tres que se eligen: agentes, creador de agentes y asistente interno. Las
 * demás llamadas se pegan a una de ellas:
 *
 * | Uso (`AiUse`)  | Función    | Esfuerzo                        |
 * |----------------|------------|---------------------------------|
 * | agent, writing | agentes    | el de los agentes (bajo)        |
 * | creator, judge | creador    | el del creador (bajo)           |
 * | assistant      | asistente  | Rápido bajo · Normal medio · Profundo alto |
 * | analysis       | asistente  | bajo (revisa muchos chats)      |
 *
 * Aquí solo se lee el entorno (los valores de la INSTANCIA). Lo que se elija
 * por plan o por empresa desde Plataforma se aplica encima en el servidor.
 * Funciones puras: no llaman a nadie.
 */

export const AI_EFFORTS = ["none", "low", "medium", "high"] as const;
export type AiEffort = (typeof AI_EFFORTS)[number];

export const AI_FUNCTIONS = ["agent", "creator", "assistant"] as const;
export type AiFunction = (typeof AI_FUNCTIONS)[number];

export type AiUse = "agent" | "writing" | "creator" | "judge" | "assistant" | "analysis";
export type AssistantMode = "fast" | "normal" | "deep";

const ASSISTANT_MODE_EFFORT: Record<AssistantMode, AiEffort> = { fast: "low", normal: "medium", deep: "high" };

export const AI_EFFORT_LABEL: Record<AiEffort, string> = {
  none: "Sin razonamiento",
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
};


export function functionOfUse(use: AiUse): AiFunction {
  if (use === "agent" || use === "writing") return "agent";
  if (use === "creator" || use === "judge") return "creator";
  return "assistant";
}

export function parseEffort(v: string | undefined | null): AiEffort | undefined {
  const t = v?.trim().toLowerCase();
  return (AI_EFFORTS as readonly string[]).includes(t ?? "") ? (t as AiEffort) : undefined;
}

export type AiChoice = { model: string | undefined; effort: AiEffort };

type ChoiceEnv = Pick<
  Env,
  | "OPENROUTER_MODEL"
  | "OPENROUTER_JUDGE_MODEL"
  | "OPENROUTER_ANALYSIS_MODEL"
  | "OPENROUTER_CREATOR_MODEL"
  | "ASSISTANT_MODEL"
  | "ASSISTANT_MODEL_FAST"
  | "ASSISTANT_MODEL_NORMAL"
  | "ASSISTANT_MODEL_DEEP"
  | "AI_AGENT_EFFORT"
  | "AI_CREATOR_EFFORT"
>;

const clean = (v: string | undefined | null) => v?.trim() || undefined;

/**
 * El modelo de la instancia para una FUNCIÓN (lo que Plataforma muestra como
 * «Modelos de Dashfort»). Variables nuevas primero; las viejas siguen valiendo
 * para que una instalación que ya las tiene no cambie de modelo sola.
 */
export function envFunctionModel(fn: AiFunction, env: ChoiceEnv, mode: AssistantMode = "normal"): string | undefined {
  const main = clean(env.OPENROUTER_MODEL);
  if (fn === "agent") return main;
  if (fn === "creator") return clean(env.OPENROUTER_CREATOR_MODEL) ?? clean(env.OPENROUTER_JUDGE_MODEL) ?? main;
  const own = clean(env.ASSISTANT_MODEL);
  if (own) return own;
  // Cadena de antes (ASSISTANT_MODEL_FAST/NORMAL/DEEP).
  const normal = clean(env.ASSISTANT_MODEL_NORMAL) ?? clean(env.OPENROUTER_ANALYSIS_MODEL) ?? clean(env.OPENROUTER_JUDGE_MODEL);
  const legacy = mode === "fast" ? clean(env.ASSISTANT_MODEL_FAST) : mode === "deep" ? (clean(env.ASSISTANT_MODEL_DEEP) ?? normal) : normal;
  return legacy ?? main;
}

export function envFunctionEffort(fn: AiFunction, env: ChoiceEnv): AiEffort {
  if (fn === "agent") return parseEffort(env.AI_AGENT_EFFORT) ?? "low";
  if (fn === "creator") return parseEffort(env.AI_CREATOR_EFFORT) ?? "low";
  return "medium";
}

/** Modelo y esfuerzo de un uso según el entorno. */
export function envChoice(use: AiUse, env: ChoiceEnv, mode: AssistantMode = "normal"): AiChoice {
  const fn = functionOfUse(use);
  if (use === "analysis") {
    const model = clean(env.ASSISTANT_MODEL) ?? clean(env.OPENROUTER_ANALYSIS_MODEL) ?? clean(env.OPENROUTER_MODEL);
    return { model, effort: "low" };
  }
  if (use === "assistant") return { model: envFunctionModel("assistant", env, mode), effort: ASSISTANT_MODE_EFFORT[mode] };
  return { model: envFunctionModel(fn, env), effort: envFunctionEffort(fn, env) };
}

/** El uso que corresponde a cada tipo de cuota cuando quien llama no lo dice. */
export function defaultUseOfKind(kind: string): AiUse {
  if (kind === "judge") return "judge";
  if (kind === "assistant") return "assistant";
  if (kind === "analysis") return "analysis";
  if (kind === "writing") return "writing";
  return "agent";
}

/**
 * 0070 — Una capa de valores elegidos (empresa, plan o instancia). NULL o
 * ausente = hereda de la siguiente capa; al final, el entorno.
 */
type AiLayer = {
  agentModel?: string | null;
  agentEffort?: AiEffort | null;
  creatorModel?: string | null;
  creatorEffort?: AiEffort | null;
  assistantModel?: string | null;
};

const firstOf = <T>(values: (T | null | undefined)[]): T | undefined => values.find((v) => v !== null && v !== undefined) ?? undefined;

/**
 * Modelo y esfuerzo de un uso con las capas en orden de prioridad (empresa,
 * plan, instancia) y, al final, el entorno. Pura.
 */
export function layeredChoice(use: AiUse, layers: AiLayer[], env: ChoiceEnv, mode: AssistantMode = "normal"): AiChoice {
  const base = envChoice(use, env, mode);
  const fn = functionOfUse(use);
  if (fn === "agent") {
    return {
      model: firstOf(layers.map((l) => l.agentModel)) ?? base.model,
      effort: firstOf(layers.map((l) => l.agentEffort)) ?? base.effort,
    };
  }
  if (fn === "creator") {
    return {
      model: firstOf(layers.map((l) => l.creatorModel)) ?? base.model,
      effort: use === "judge" ? base.effort : (firstOf(layers.map((l) => l.creatorEffort)) ?? base.effort),
    };
  }
  // Asistente y análisis: el esfuerzo lo da el modo (o «bajo» al analizar).
  return { model: firstOf(layers.map((l) => l.assistantModel)) ?? base.model, effort: base.effort };
}
