import { describe, expect, it, vi, beforeEach } from "vitest";

/** Plataforma → Costos: modelos en uso (sin llaves) y precios de OpenRouter. */

const env: Record<string, unknown> = {};
vi.mock("@/lib/env", () => ({ getEnv: () => env }));

import { getModelsInUse, lookupOpenRouterPrices, providerKindOf } from "@/server/costs/models";

beforeEach(() => {
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, {
    OPENROUTER_BASE_URL: "https://openrouter.ai/api",
    OPENROUTER_API_TOKEN: "sk-or-SECRETO-1234567890",
    OPENROUTER_MODEL: "anthropic/claude-haiku-4.5",
    EMBEDDINGS_MODEL: "intfloat/multilingual-e5-small",
  });
});

describe("modelos en uso", () => {
  it("reconoce el proveedor por dominio", () => {
    expect(providerKindOf("https://openrouter.ai/api")).toBe("openrouter");
    expect(providerKindOf("https://bedrock-runtime.us-east-1.amazonaws.com")).toBe("bedrock");
    expect(providerKindOf("https://bedrock-mantle.us-east-1.api.aws")).toBe("bedrock");
    expect(providerKindOf("https://api.openai.com")).toBe("openai");
    expect(providerKindOf("no es url")).toBe("other");
  });
  it("juez y análisis caen al principal si no tienen variable; nunca sale la llave", () => {
    env.OPENROUTER_ANALYSIS_MODEL = "anthropic/claude-sonnet-5.5";
    const m = getModelsInUse();
    expect(m.models.map((x) => [x.role, x.model, x.source])).toEqual([
      ["main", "anthropic/claude-haiku-4.5", "own"],
      ["judge", "anthropic/claude-haiku-4.5", "fallback"],
      ["analysis", "anthropic/claude-sonnet-5.5", "own"],
      ["embed", null, "none"],
    ]);
    expect(m.hasToken).toBe(true);
    expect(m.pricesByApi).toBe(true);
    expect(JSON.stringify(m)).not.toContain("SECRETO");
    expect(m.models[2]!.suggestion).toMatchObject({ inputUsdPerMtok: 2, outputUsdPerMtok: 10 });
  });
});

describe("precios de OpenRouter", () => {
  const body = { data: [{ id: "anthropic/claude-haiku-4.5", pricing: { prompt: "0.000001", completion: "0.000005" } }] };
  it("lee los precios de los modelos en uso", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(body)));
    const r = await lookupOpenRouterPrices(f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith("https://openrouter.ai/api/v1/models", expect.anything());
    expect(r?.main).toMatchObject({ inputUsdPerMtok: 1, outputUsdPerMtok: 5 });
    expect(r?.analysis).toMatchObject({ inputUsdPerMtok: 1 }); // cae al principal
  });
  it("con otro proveedor no llama a nadie", async () => {
    env.OPENROUTER_BASE_URL = "https://bedrock-runtime.us-east-1.amazonaws.com";
    const f = vi.fn();
    expect(await lookupOpenRouterPrices(f as unknown as typeof fetch)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it("si OpenRouter falla, lanza", async () => {
    await expect(lookupOpenRouterPrices((async () => new Response("", { status: 503 })) as unknown as typeof fetch)).rejects.toThrow("503");
  });
});
