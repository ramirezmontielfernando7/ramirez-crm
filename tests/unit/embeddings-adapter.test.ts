import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  EMBED_BATCH,
  embeddingsConfig,
  embedTexts,
  isE5Model,
  normalize,
  withE5Prefix,
  type EmbeddingsConfig,
} from "@/lib/ai/embeddings";

/**
 * 035 — Adaptador de embeddings. Lo más importante: los modelos e5 reciben
 * «query: » en la pregunta del cliente y «passage: » en los fragmentos. Sin
 * eso la calidad en español cae mucho, y nada más fallaría: por eso se
 * verifica en el CUERPO de la petición que sale hacia el servicio.
 */

const E5: EmbeddingsConfig = { baseUrl: "http://emb.test", model: "intfloat/multilingual-e5-small", token: null, e5: true };

type Sent = { url: string; headers: Record<string, string>; body: { model: string; input: string[] } };
let sent: Sent[] = [];

function fakeService(dims = 4) {
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Sent["body"];
      sent.push({ url, headers: init.headers as Record<string, string>, body });
      return Response.json({
        data: body.input.map((_t, index) => ({ index, embedding: Array.from({ length: dims }, (_, i) => i + 1 + index) })),
        usage: { prompt_tokens: body.input.length * 3 },
      });
    })
  );
}

/** Lo mínimo para que `getEnv()` valide (las pruebas que leen el entorno). */
function baseEnv() {
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgresql://x:y@localhost:5432/z");
  vi.stubEnv("BETTER_AUTH_SECRET", "secreto-de-prueba-123456");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "tok-de-prueba");
}

beforeEach(() => {
  baseEnv();
  resetEnvCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
});

describe("prefijos e5", () => {
  it("reconoce los modelos e5 por su nombre", () => {
    expect(isE5Model("intfloat/multilingual-e5-small")).toBe(true);
    expect(isE5Model("intfloat/multilingual-e5-base")).toBe(true);
    expect(isE5Model("intfloat/e5-large-v2")).toBe(true);
    expect(isE5Model("e5-small")).toBe(true);
    expect(isE5Model("nomic-embed-text")).toBe(false);
    expect(isE5Model("BAAI/bge-m3")).toBe(false);
    expect(isE5Model("text-embedding-3-small")).toBe(false);
  });

  it("antepone «query: » a la pregunta y «passage: » a los fragmentos", () => {
    expect(withE5Prefix("¿cuánto cuesta el envío?", "query", true)).toBe("query: ¿cuánto cuesta el envío?");
    expect(withE5Prefix("Envío gratis desde $500", "passage", true)).toBe("passage: Envío gratis desde $500");
    expect(withE5Prefix("hola", "query", false)).toBe("hola");
  });

  it("la pregunta del cliente SALE hacia el servicio con «query: »", async () => {
    fakeService();
    const r = await embedTexts(["¿hacen envíos a Monterrey?"], "query", { config: E5 });
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("http://emb.test/v1/embeddings");
    expect(sent[0]!.body.model).toBe("intfloat/multilingual-e5-small");
    expect(sent[0]!.body.input).toEqual(["query: ¿hacen envíos a Monterrey?"]);
  });

  it("los fragmentos SALEN con «passage: », todos, también en varios lotes", async () => {
    fakeService();
    const textos = Array.from({ length: EMBED_BATCH + 5 }, (_, i) => `Fragmento ${i}`);
    const r = await embedTexts(textos, "passage", { config: E5 });
    expect(r.ok && r.vectors.length).toBe(textos.length);
    expect(sent).toHaveLength(2);
    const todos = sent.flatMap((s) => s.body.input);
    expect(todos).toHaveLength(textos.length);
    expect(todos.every((t) => t.startsWith("passage: "))).toBe(true);
    expect(todos[0]).toBe("passage: Fragmento 0");
  });

  it("un modelo que no es e5 recibe el texto tal cual", async () => {
    fakeService();
    await embedTexts(["hola"], "query", { config: { ...E5, model: "BAAI/bge-m3", e5: false } });
    expect(sent[0]!.body.input).toEqual(["hola"]);
  });

  it("del entorno: auto con e5 → prefijos; EMBEDDINGS_PREFIX_MODE=none → sin prefijos", () => {
    vi.stubEnv("EMBEDDINGS_BASE_URL", "http://vocero-embeddings:80/");
    vi.stubEnv("EMBEDDINGS_MODEL", "intfloat/multilingual-e5-small");
    resetEnvCacheForTests();
    expect(embeddingsConfig()).toMatchObject({ baseUrl: "http://vocero-embeddings", e5: true, token: null });
    vi.stubEnv("EMBEDDINGS_PREFIX_MODE", "none");
    resetEnvCacheForTests();
    expect(embeddingsConfig()?.e5).toBe(false);
    vi.stubEnv("EMBEDDINGS_PREFIX_MODE", "e5");
    vi.stubEnv("EMBEDDINGS_MODEL", "mi-modelo-propio");
    resetEnvCacheForTests();
    expect(embeddingsConfig()?.e5).toBe(true);
  });
});

describe("adaptador", () => {
  it("sin EMBEDDINGS_BASE_URL (o con un placeholder o una URL inválida) no hay servicio", async () => {
    vi.stubEnv("EMBEDDINGS_BASE_URL", "");
    resetEnvCacheForTests();
    expect(embeddingsConfig()).toBeNull();
    vi.stubEnv("EMBEDDINGS_BASE_URL", "REEMPLAZA_URL_DEL_SERVICIO");
    resetEnvCacheForTests();
    expect(embeddingsConfig()).toBeNull();
    vi.stubEnv("EMBEDDINGS_BASE_URL", "no es una url");
    resetEnvCacheForTests();
    expect(embeddingsConfig()).toBeNull();
    const r = await embedTexts(["x"], "query", { config: null });
    expect(r).toMatchObject({ ok: false, error: "not_configured" });
  });

  it("los vectores vuelven normalizados (longitud 1) y en el orden de los textos", async () => {
    sent = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          // Desordenados a propósito: manda `index`.
          data: [
            { index: 1, embedding: [0, 3, 4] },
            { index: 0, embedding: [2, 0, 0] },
          ],
        })
      )
    );
    const r = await embedTexts(["a", "b"], "passage", { config: E5 });
    if (!r.ok) throw new Error(r.detail);
    expect(Array.from(r.vectors[0]!)).toEqual([1, 0, 0]);
    expect(r.vectors[1]![1]).toBeCloseTo(0.6);
    expect(r.vectors[1]![2]).toBeCloseTo(0.8);
    // Sin `usage`, se estima (~4 caracteres por token, prefijos incluidos).
    expect(r.tokens).toBeGreaterThan(0);
  });

  it("el token viaja solo en el header Authorization (y solo si existe)", async () => {
    fakeService();
    await embedTexts(["x"], "query", { config: E5 });
    expect(sent[0]!.headers.Authorization).toBeUndefined();
    await embedTexts(["x"], "query", { config: { ...E5, token: "sk-secreto" } });
    expect(sent[1]!.headers.Authorization).toBe("Bearer sk-secreto");
    expect(JSON.stringify(sent[1]!.body)).not.toContain("sk-secreto");
  });

  it("un servicio caído no lanza: devuelve provider_error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ups", { status: 503 })));
    const r = await embedTexts(["x"], "query", { config: E5 });
    expect(r).toMatchObject({ ok: false, error: "provider_error" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))));
    expect(await embedTexts(["x"], "query", { config: E5 })).toMatchObject({ ok: false, error: "provider_error" });
  });

  it("una respuesta rara es invalid_output (vectores que faltan, con NaN o de distinta dimensión)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [] })));
    expect(await embedTexts(["x"], "query", { config: E5 })).toMatchObject({ ok: false, error: "invalid_output" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ index: 0, embedding: [1, "a"] }] })));
    expect(await embedTexts(["x"], "query", { config: E5 })).toMatchObject({ ok: false, error: "invalid_output" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [{ index: 0, embedding: [1, 2] }, { index: 1, embedding: [1, 2, 3] }] }))
    );
    expect(await embedTexts(["x", "y"], "query", { config: E5 })).toMatchObject({ ok: false, error: "invalid_output" });
  });

  it("normalize rechaza vectores vacíos, nulos o con valores no numéricos", () => {
    expect(normalize([])).toBeNull();
    expect(normalize([0, 0])).toBeNull();
    expect(normalize([1, Number.NaN])).toBeNull();
    expect(normalize("x")).toBeNull();
  });
});
