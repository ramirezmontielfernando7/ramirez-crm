import { getEnv } from "@/lib/env";
import { logger } from "@/lib/log";
import { assertNoOpenTransaction, providerCost } from "@/lib/ai";

/**
 * 035 — Adaptador de embeddings OpenAI-compatible (`POST {base}/v1/embeddings`).
 * Lo hablan igual el contenedor local (Hugging Face TEI), Ollama, OpenRouter y
 * OpenAI: cambiar de uno a otro es cambiar variables, no código.
 *
 * Reglas, como `chatJson`: jamás lanza (resultado tipado), jamás con una
 * transacción de BD abierta, y el token solo viaja en el header. Nadie lo
 * llama directo: la única puerta es `embedForOrg` (src/server/ai-quota/embed.ts),
 * que cuenta el uso por organización (test de vigilancia `embed-gate.test.ts`).
 *
 * Los modelos e5 (`intfloat/multilingual-e5-*`) se entrenaron con prefijos:
 * «query: » para lo que se busca y «passage: » para lo que se guarda. Sin
 * ellos la calidad cae mucho (sobre todo en español), así que el adaptador
 * los pone solo (`withE5Prefix`).
 */

export type EmbedPurpose = "query" | "passage";

export type EmbedResult =
  | {
      ok: true;
      vectors: Float32Array[];
      model: string;
      tokens: number;
      /** 036 (PR 3b): costo real que reportó el servicio (`usage.cost`), si lo mandó. */
      costUsd?: number;
    }
  | {
      ok: false;
      // `quota_exceeded` lo produce `embedForOrg`, nunca este archivo.
      error: "not_configured" | "provider_error" | "invalid_output" | "quota_exceeded";
      detail: string;
    };

export type EmbeddingsConfig = {
  baseUrl: string;
  model: string;
  token: string | null;
  e5: boolean;
};

const log = logger("ai");

/** Lote por petición: TEI acepta 32 por defecto (`--max-client-batch-size`). */
export const EMBED_BATCH = 32;
const MAX_ATTEMPTS = 2;

/** ¿El nombre del modelo es de la familia e5? (`intfloat/multilingual-e5-small`, `e5-base-v2`…) */
export function isE5Model(model: string): boolean {
  return /(^|[/_-])(multilingual-)?e5([-_.]|$)/i.test(model.trim());
}

/** El texto tal como lo espera el modelo (con su prefijo si es e5). */
export function withE5Prefix(text: string, purpose: EmbedPurpose, e5: boolean): string {
  if (!e5) return text;
  return `${purpose === "query" ? "query: " : "passage: "}${text}`;
}

function isPlaceholder(v: string | undefined): boolean {
  return !v || !v.trim() || v.trim().startsWith("REEMPLAZA");
}

let warnedBadUrl = false;

/** La configuración vigente, o `null` si no hay servicio de embeddings. */
export function embeddingsConfig(): EmbeddingsConfig | null {
  const env = getEnv();
  if (isPlaceholder(env.EMBEDDINGS_BASE_URL)) return null;
  let baseUrl: string;
  try {
    const u = new URL(env.EMBEDDINGS_BASE_URL!.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("protocolo");
    baseUrl = u.toString().replace(/\/+$/, "");
  } catch {
    if (!warnedBadUrl) {
      warnedBadUrl = true;
      log.warn("EMBEDDINGS_BASE_URL no es una URL http(s) válida: los documentos se buscan solo por texto");
    }
    return null;
  }
  const model = env.EMBEDDINGS_MODEL.trim();
  const mode = env.EMBEDDINGS_PREFIX_MODE;
  return {
    baseUrl,
    model,
    token: isPlaceholder(env.EMBEDDINGS_API_TOKEN) ? null : env.EMBEDDINGS_API_TOKEN!.trim(),
    e5: mode === "e5" || (mode === "auto" && isE5Model(model)),
  };
}

/** Vector a longitud 1 (así el coseno es un producto punto). `null` si no sirve. */
export function normalize(v: unknown): Float32Array | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out = new Float32Array(v.length);
  let norm = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
    out[i] = x;
    norm += x * x;
  }
  if (norm === 0) return null;
  const k = 1 / Math.sqrt(norm);
  for (let i = 0; i < out.length; i++) out[i]! *= k;
  return out;
}

/**
 * Embebe `texts` (en lotes). Con `config` explícita para pruebas; si no, la
 * del entorno. Todo o nada: si un lote falla, el resultado es el error.
 */
export async function embedTexts(
  texts: string[],
  purpose: EmbedPurpose,
  opts: { timeoutMs?: number; config?: EmbeddingsConfig | null } = {}
): Promise<EmbedResult> {
  assertNoOpenTransaction();
  const config = opts.config === undefined ? embeddingsConfig() : opts.config;
  if (!config) return { ok: false, error: "not_configured", detail: "sin EMBEDDINGS_BASE_URL" };
  if (texts.length === 0) return { ok: true, vectors: [], model: config.model, tokens: 0 };

  const vectors: Float32Array[] = [];
  let tokens = 0;
  let costUsd: number | undefined;
  let dims = 0;
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH).map((t) => withE5Prefix(t, purpose, config.e5));
    const r = await callBatch(config, batch, opts.timeoutMs ?? 30_000);
    if (!r.ok) return r;
    for (const v of r.vectors) {
      if (dims === 0) dims = v.length;
      if (v.length !== dims) return { ok: false, error: "invalid_output", detail: "vectores de distinta dimensión" };
      vectors.push(v);
    }
    tokens += r.tokens;
    if (r.costUsd !== undefined) costUsd = (costUsd ?? 0) + r.costUsd;
  }
  return { ok: true, vectors, model: config.model, tokens, ...(costUsd !== undefined ? { costUsd } : {}) };
}

async function callBatch(
  config: EmbeddingsConfig,
  input: string[],
  timeoutMs: number
): Promise<{ ok: true; vectors: Float32Array[]; tokens: number; costUsd?: number } | Extract<EmbedResult, { ok: false }>> {
  let lastDetail = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${config.baseUrl}/v1/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // El token jamás se loguea; solo viaja en este header.
          ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
        },
        body: JSON.stringify({ model: config.model, input }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        lastDetail = `el servicio de embeddings respondió ${res.status}: ${text.slice(0, 200)}`;
        // Un 4xx no mejora reintentando (salvo 429).
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
        continue;
      }
      const json = (await res.json().catch(() => null)) as {
        data?: { embedding?: unknown; index?: unknown }[];
        usage?: { prompt_tokens?: unknown; total_tokens?: unknown; cost?: unknown };
      } | null;
      const data = json?.data;
      if (!Array.isArray(data) || data.length !== input.length) {
        return { ok: false, error: "invalid_output", detail: "respuesta sin un vector por texto" };
      }
      // `index` dice a qué texto corresponde cada vector (el orden no está garantizado).
      const ordered = [...data].sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
      const vectors: Float32Array[] = [];
      for (const d of ordered) {
        const v = normalize(d.embedding);
        if (!v) return { ok: false, error: "invalid_output", detail: "un vector vino vacío o con valores no numéricos" };
        vectors.push(v);
      }
      const reported = Number(json?.usage?.prompt_tokens ?? json?.usage?.total_tokens ?? 0);
      const tokens =
        Number.isFinite(reported) && reported > 0
          ? Math.floor(reported)
          : Math.ceil(input.reduce((n, t) => n + t.length, 0) / 4);
      const costUsd = providerCost(json?.usage?.cost);
      return { ok: true, vectors, tokens, ...(costUsd !== undefined ? { costUsd } : {}) };
    } catch (err) {
      lastDetail = err instanceof Error ? (err.name === "AbortError" ? "tiempo de espera agotado" : err.message) : String(err);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: "provider_error", detail: lastDetail };
}
