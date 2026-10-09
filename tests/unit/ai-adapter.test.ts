import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { chatJson, extractJson, providerCost } from "@/lib/ai";

describe("extractJson (extracción robusta)", () => {
  it("JSON limpio", () => {
    expect(extractJson('{"action":"none"}')).toEqual({ action: "none" });
  });

  it("bloque ```json con texto alrededor", () => {
    const raw = 'Claro, aquí está:\n```json\n{"action":"reply","text":"hola"}\n```\nEspero que sirva.';
    expect(extractJson(raw)).toEqual({ action: "reply", text: "hola" });
  });

  it("JSON incrustado en prosa (primer { al último })", () => {
    const raw = 'La acción que tomaré es {"action":"handoff","reason":"cliente"} por lo dicho.';
    expect(extractJson(raw)).toEqual({ action: "handoff", reason: "cliente" });
  });

  it("sin JSON → null", () => {
    expect(extractJson("no tengo nada que decir")).toBeNull();
  });
});

describe("chatJson (reintentos y errores tipados)", () => {
  const schema = z.object({ action: z.literal("reply"), text: z.string() });

  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    vi.stubEnv("OPENROUTER_MODEL", "modelo-test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function providerResponse(content: string) {
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  function withUsage(content: string, usage: Record<string, unknown>) {
    return new Response(JSON.stringify({ id: "gen-123", choices: [{ message: { content } }], usage }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  it("036 PR 3b: lee el costo real (usage.cost) y lo suma entre reintentos", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(withUsage("no soy json", { prompt_tokens: 10, completion_tokens: 2, cost: 0.0012 }))
      .mockResolvedValueOnce(withUsage('{"action":"reply","text":"ok"}', { prompt_tokens: 12, completion_tokens: 3, cost: 0.0015 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(true);
    expect(result.usage?.promptTokens).toBe(22);
    expect(result.usage?.costUsd).toBeCloseTo(0.0027, 10);
    // No pide nada extra al proveedor: el cuerpo es el de siempre.
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(Object.keys(body).sort()).toEqual(["messages", "model"]);
  });

  it("036 PR 3b: sin usage.cost (otro proveedor) el costo queda ausente, no en 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(withUsage('{"action":"reply","text":"ok"}', { prompt_tokens: 5, completion_tokens: 1 })));
    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(true);
    expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 1 });
  });

  it("salida inválida al primer intento → reintenta con STRICT y triunfa", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(providerResponse("no soy json"))
      .mockResolvedValueOnce(providerResponse('{"action":"reply","text":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // el reintento agrega la instrucción STRICT
    const secondBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(JSON.stringify(secondBody.messages)).toContain("STRICT");
  });

  it("proveedor caído (500 persistente) → error tipado, jamás excepción", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response("boom", { status: 500 }))
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("provider_error");
    expect(fetchMock).toHaveBeenCalledTimes(3); // agotó los 3 intentos
  });

  it("salida que nunca cumple el esquema → invalid_output", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(providerResponse('{"action":"otra_cosa"}'))
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_output");
  });

  it("sin token → not_configured sin tocar la red", async () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("providerCost (036 PR 3b)", () => {
  it("acepta números y cadenas numéricas ≥ 0; lo demás es «no vino»", () => {
    expect(providerCost(0.5)).toBe(0.5);
    expect(providerCost("0.25")).toBe(0.25);
    expect(providerCost(0)).toBe(0);
    expect(providerCost(-1)).toBeUndefined();
    expect(providerCost("abc")).toBeUndefined();
    expect(providerCost(null)).toBeUndefined();
    expect(providerCost(undefined)).toBeUndefined();
    expect(providerCost(Number.NaN)).toBeUndefined();
  });
});
