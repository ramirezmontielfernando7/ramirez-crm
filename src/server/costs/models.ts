import { getEnv } from "@/lib/env";
import { AI_ROLES, parseOpenRouterPrice, suggestedPriceFor, type AiRole, type PriceSuggestion } from "@/lib/costs";

/**
 * Plataforma → Costos: qué modelo usa cada función según las variables de
 * entorno de ESTA instancia, y (solo si el operador lo pide con el botón) los
 * precios publicados por OpenRouter. Nunca devuelve llaves ni tokens: del
 * proveedor solo el dominio, y de la llave solo si existe.
 */

export type ProviderKind = "openrouter" | "bedrock" | "openai" | "other";

export type ModelInUse = {
  role: AiRole;
  /** `null` = sin modelo (embeddings sin servicio, por ejemplo). */
  model: string | null;
  /** De dónde sale: su propia variable o el respaldo. */
  source: "own" | "fallback" | "none";
  /** Si cae al principal, qué dice. */
  fallbackOf?: AiRole;
  /** Dominio del servicio (sin ruta ni credenciales). */
  host: string | null;
  /** Hay precio de referencia en la lista de modelos conocidos. */
  suggestion: PriceSuggestion | null;
};

export type ModelsInUse = {
  provider: ProviderKind;
  providerHost: string | null;
  /** ¿Hay llave puesta? (solo sí/no). */
  hasToken: boolean;
  /** ¿Los precios se pueden traer por API de este proveedor? */
  pricesByApi: boolean;
  models: ModelInUse[];
};

export function providerKindOf(baseUrl: string | undefined): ProviderKind {
  const host = hostOf(baseUrl);
  if (!host) return "other";
  if (host === "openrouter.ai" || host.endsWith(".openrouter.ai")) return "openrouter";
  if (/(^|\.)amazonaws\.com$|\.api\.aws$/.test(host) && /bedrock/.test(host)) return "bedrock";
  if (host === "api.openai.com") return "openai";
  return "other";
}

function hostOf(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    return new URL(url.trim()).host.toLowerCase();
  } catch {
    return null;
  }
}

export function getModelsInUse(): ModelsInUse {
  const env = getEnv();
  const main = env.OPENROUTER_MODEL?.trim() || null;
  const judge = env.OPENROUTER_JUDGE_MODEL?.trim() || null;
  const analysis = env.OPENROUTER_ANALYSIS_MODEL ?? null;
  const host = hostOf(env.OPENROUTER_BASE_URL);
  const embedHost = hostOf(env.EMBEDDINGS_BASE_URL);
  const embedModel = embedHost ? env.EMBEDDINGS_MODEL.trim() : null;
  const provider = providerKindOf(env.OPENROUTER_BASE_URL);

  const chat = (role: AiRole, own: string | null): ModelInUse => {
    const model = own ?? (role === "main" ? null : main);
    return {
      role,
      model,
      source: own ? "own" : model ? "fallback" : "none",
      ...(!own && model ? { fallbackOf: "main" as const } : {}),
      host,
      suggestion: suggestedPriceFor(model),
    };
  };
  return {
    provider,
    providerHost: host,
    hasToken: !!env.OPENROUTER_API_TOKEN?.trim(),
    pricesByApi: provider === "openrouter",
    models: [
      chat("main", main),
      chat("judge", judge),
      chat("analysis", analysis),
      { role: "embed", model: embedModel, source: embedModel ? "own" : "none", host: embedHost, suggestion: null },
    ],
  };
}

export type OpenRouterLookup = Partial<Record<AiRole, PriceSuggestion | null>>;

/**
 * Pide a OpenRouter su lista pública de modelos (`GET /v1/models`, sin llave)
 * y saca el precio de cada modelo en uso. Solo si el proveedor ES OpenRouter.
 * Es la ÚNICA llamada saliente de este panel que no es «Probar conexión», y
 * solo ocurre cuando el administrador pulsa el botón.
 */
export async function lookupOpenRouterPrices(fetchImpl: typeof fetch = fetch): Promise<OpenRouterLookup | null> {
  const env = getEnv();
  if (providerKindOf(env.OPENROUTER_BASE_URL) !== "openrouter") return null;
  const res = await fetchImpl(`${env.OPENROUTER_BASE_URL.replace(/\/+$/, "")}/v1/models`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`OpenRouter respondió ${res.status}`);
  const json = (await res.json()) as unknown;
  const out: OpenRouterLookup = {};
  for (const m of getModelsInUse().models) {
    if (!AI_ROLES.includes(m.role) || m.role === "embed") continue;
    out[m.role] = m.model ? parseOpenRouterPrice(json, m.model) : null;
  }
  return out;
}
