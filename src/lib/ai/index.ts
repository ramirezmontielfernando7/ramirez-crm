import type { z } from "zod";
import { getEnv, isAiConfigured } from "@/lib/env";
import { logger } from "@/lib/log";
import { hasOpenTransaction } from "@/lib/request-context";

/**
 * Adaptador LLM OpenRouter-compatible — ÚNICA frontera con el proveedor de IA
 * (Constitución II). Regla operativa: la salida del modelo es impredecible;
 * todo consumo pasa por extracción robusta + Zod + reintentos, y un hipo del
 * proveedor jamás propaga excepción (resultado `error` tipado).
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/**
 * Tokens que reportó el proveedor (`usage`), sumados entre reintentos.
 * 036 (PR 3b): `costUsd` es el costo REAL que reporta OpenRouter
 * (`usage.cost`, en créditos = USD), sumado entre reintentos; ausente si el
 * proveedor no lo manda (otro proveedor compatible, el contenedor local…).
 */
export type LlmUsage = { promptTokens: number; completionTokens: number; costUsd?: number };

export type ChatJsonResult<T> =
  | { ok: true; data: T; raw: string; usage?: LlmUsage }
  | {
      ok: false;
      // `quota_exceeded` lo produce `src/server/ai/llm.ts` (Fase 3) antes de
      // llamar; aquí nunca.
      error: "not_configured" | "provider_error" | "invalid_output" | "quota_exceeded";
      detail: string;
      usage?: LlmUsage;
    };

/**
 * PR 3 multitenant — Una llamada al LLM tarda segundos. Con una transacción
 * de BD abierta (`withTenant` o `db.transaction()`), esa conexión del pool
 * queda tomada todo ese tiempo, y con decenas de organizaciones a la vez el
 * pool se agota. Fuera de producción es un error que tumba la prueba
 * (`tests/unit/llm-sin-transaccion.test.ts`, E2E); en producción se registra
 * y la llamada sigue, para no dejar a un cliente sin respuesta.
 */
export class LlmInTransactionError extends Error {
  constructor() {
    super("llamada al LLM con una transacción de BD abierta: cierra withTenant antes de llamar al modelo");
    this.name = "LlmInTransactionError";
  }
}

/** También la usa el adaptador de embeddings (035): misma regla, mismo motivo. */
export function assertNoOpenTransaction(): void {
  if (!hasOpenTransaction()) return;
  const err = new LlmInTransactionError();
  if (process.env.NODE_ENV !== "production") throw err;
  logger("ai").error("llamada al LLM dentro de una transacción", { err });
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

export async function chatJson<T>(
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  opts?: { model?: string; judge?: boolean; timeoutMs?: number }
): Promise<ChatJsonResult<T>> {
  assertNoOpenTransaction();
  if (!isAiConfigured()) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Sin OPENROUTER_API_TOKEN configurado",
    };
  }
  const env = getEnv();
  const model =
    opts?.model ??
    (opts?.judge
      ? (env.OPENROUTER_JUDGE_MODEL ?? env.OPENROUTER_MODEL)
      : env.OPENROUTER_MODEL);
  if (!model?.trim()) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Sin OPENROUTER_MODEL configurado",
    };
  }

  let lastDetail = "";
  const usage: LlmUsage = { promptTokens: 0, completionTokens: 0 };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptMessages: ChatMessage[] =
      attempt === 1
        ? messages
        : [
            ...messages,
            {
              role: "system",
              content:
                "STRICT: tu respuesta anterior no fue JSON válido según el esquema. Responde ÚNICAMENTE el objeto JSON, sin explicaciones ni markdown.",
            },
          ];
    try {
      const reply = await callProvider(model, attemptMessages, opts?.timeoutMs);
      usage.promptTokens += reply.usage.promptTokens;
      usage.completionTokens += reply.usage.completionTokens;
      if (reply.usage.costUsd !== undefined) usage.costUsd = (usage.costUsd ?? 0) + reply.usage.costUsd;
      const raw = reply.content;
      const extracted = extractJson(raw);
      if (extracted === null) {
        lastDetail = `sin JSON extraíble (raw=${truncate(raw)})`;
        continue;
      }
      const parsed = schema.safeParse(extracted);
      if (!parsed.success) {
        lastDetail = `no cumple el esquema: ${parsed.error.issues
          .map((i) => i.path.join(".") + " " + i.message)
          .join("; ")} (raw=${truncate(raw)})`;
        continue;
      }
      return { ok: true, data: parsed.data, raw, usage };
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  return {
    ok: false,
    error: lastDetail.includes("esquema") || lastDetail.includes("JSON")
      ? "invalid_output"
      : "provider_error",
    detail: lastDetail,
    usage,
  };
}

async function callProvider(
  model: string,
  messages: ChatMessage[],
  timeoutMs = 60_000
): Promise<{ content: string; usage: LlmUsage }> {
  const env = getEnv();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.OPENROUTER_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        // El token jamás se loguea; solo viaja en este header.
        Authorization: `Bearer ${env.OPENROUTER_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`proveedor respondió ${res.status}: ${truncate(text)}`);
    }
    const json = (await res.json()) as {
      id?: unknown;
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown };
    };
    const cost = providerCost(json.usage?.cost);
    // 036 (PR 3b): el id de la generación y su costo, para cotejarlo contra
    // la actividad de OpenRouter. Nunca contenido ni el token.
    if (cost !== undefined) {
      logger("ai").info("costo reportado por el proveedor", { generacion: typeof json.id === "string" ? json.id : null, modelo: model, costo_usd: cost });
    }
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("respuesta del proveedor sin contenido");
    }
    return {
      content,
      usage: {
        promptTokens: tokens(json.usage?.prompt_tokens),
        completionTokens: tokens(json.usage?.completion_tokens),
        ...(cost !== undefined ? { costUsd: cost } : {}),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracción robusta de JSON de una respuesta de modelo:
 * 1) bloque ```json ... ``` (o ``` ... ```), 2) el texto completo,
 * 3) del primer `{` al último `}`.
 */
export function extractJson(raw: string): unknown | null {
  const candidates: string[] = [];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  candidates.push(raw.trim());
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(raw.slice(first, last + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

/**
 * 036 (PR 3b) — El costo que reportó el proveedor (`usage.cost` de OpenRouter,
 * en créditos = USD), o `undefined` si no vino o vino raro. Un 0 sí cuenta
 * (modelo gratis): es un costo real reportado.
 */
export function providerCost(v: unknown): number | undefined {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Un conteo de tokens del proveedor, o 0 si no vino o vino raro. */
function tokens(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
