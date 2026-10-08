import { isE5Model } from "@/lib/ai/embeddings";
import { foldAccents } from "@/lib/kb-docs";

/**
 * 035 — Servicio de embeddings determinista para el self-test (solo detrás
 * del gate de mocks). Habla el mismo contrato OpenAI-compatible que TEI.
 *
 * - Vector = bolsa de raíces de palabra (primeras 5 letras, sin acentos)
 *   repartidas en 384 dimensiones: textos con palabras en común se parecen.
 * - Con un modelo e5 EXIGE el prefijo «query: » o «passage: » en cada texto
 *   (400 si falta), igual de estricto que debería ser la calidad real: así el
 *   E2E prueba los prefijos de punta a punta.
 * - `FALLA-EMBED` en un texto → 500 (camino infeliz: el turno sigue solo con
 *   búsqueda por texto).
 */

export const MOCK_DIMS = 384;

type Stats = { calls: number; queries: number; passages: number; rejected: number; failed: number };
const g = globalThis as unknown as { __voceroEmbedMock?: Stats };
export function embedMockStats(): Stats {
  return (g.__voceroEmbedMock ??= { calls: 0, queries: 0, passages: 0, rejected: 0, failed: 0 });
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mockVector(text: string): number[] {
  const v: number[] = new Array<number>(MOCK_DIMS).fill(0);
  const words = foldAccents(text.toLowerCase()).match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const w of words) {
    if (w.length < 3) continue;
    v[hash(w.slice(0, 5)) % MOCK_DIMS]! += 1;
  }
  // Un texto sin palabras útiles: un vector fijo (no nulo) para no romper la norma.
  if (!v.some((x) => x !== 0)) v[0] = 1;
  return v;
}

export function embeddingsMock(body: { model?: unknown; input?: unknown }):
  | { status: 200; json: unknown }
  | { status: 400 | 500; json: unknown } {
  const stats = embedMockStats();
  stats.calls++;
  const model = typeof body.model === "string" ? body.model : "";
  const input = Array.isArray(body.input) ? body.input : typeof body.input === "string" ? [body.input] : null;
  if (!input || input.some((t) => typeof t !== "string")) {
    return { status: 400, json: { error: "input debe ser texto o lista de textos" } };
  }
  const texts = input as string[];
  if (texts.some((t) => t.includes("FALLA-EMBED"))) {
    stats.failed++;
    return { status: 500, json: { error: "falla simulada" } };
  }
  if (isE5Model(model)) {
    const sinPrefijo = texts.filter((t) => !t.startsWith("query: ") && !t.startsWith("passage: "));
    if (sinPrefijo.length > 0) {
      stats.rejected++;
      return { status: 400, json: { error: "modelo e5: falta el prefijo «query: » o «passage: »" } };
    }
  }
  for (const t of texts) {
    if (t.startsWith("query: ")) stats.queries++;
    else if (t.startsWith("passage: ")) stats.passages++;
  }
  const strip = (t: string) => t.replace(/^(query|passage): /, "");
  const chars = texts.reduce((n, t) => n + t.length, 0);
  return {
    status: 200,
    json: {
      object: "list",
      model,
      data: texts.map((t, index) => ({ object: "embedding", index, embedding: mockVector(strip(t)) })),
      usage: { prompt_tokens: Math.ceil(chars / 4), total_tokens: Math.ceil(chars / 4) },
    },
  };
}
