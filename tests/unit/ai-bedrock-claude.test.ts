import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { chatJson } from "@/lib/ai";
import { fromMessagesResponse, isBedrockClaudeModel, messagesUrl, toMessagesBody } from "@/lib/ai/anthropic-messages";

describe("isBedrockClaudeModel (qué formato usa cada modelo)", () => {
  it("Claude en Bedrock: global., us., eu. y sin prefijo", () => {
    expect(isBedrockClaudeModel("global.anthropic.claude-haiku-5-5")).toBe(true);
    expect(isBedrockClaudeModel("global.anthropic.claude-sonnet-5-5")).toBe(true);
    expect(isBedrockClaudeModel("us.anthropic.claude-sonnet-5-5")).toBe(true);
    expect(isBedrockClaudeModel("anthropic.claude-haiku-5-5")).toBe(true);
  });

  it("OpenRouter, OpenAI y los modelos no-Claude de Bedrock siguen por Chat Completions", () => {
    expect(isBedrockClaudeModel("anthropic/claude-sonnet-4.5")).toBe(false);
    expect(isBedrockClaudeModel("gpt-5-mini")).toBe(false);
    expect(isBedrockClaudeModel("openai.gpt-oss-120b")).toBe(false);
    expect(isBedrockClaudeModel("global.openai.gpt-6-luna")).toBe(false);
    expect(isBedrockClaudeModel("modelo-test")).toBe(false);
  });

  it("URL: agrega /anthropic/v1/messages sin duplicar la diagonal", () => {
    expect(messagesUrl("https://bedrock-runtime.us-east-1.amazonaws.com")).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/anthropic/v1/messages"
    );
    expect(messagesUrl("https://bedrock-runtime.us-east-1.amazonaws.com/")).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/anthropic/v1/messages"
    );
  });
});

describe("toMessagesBody (Chat Completions → Messages)", () => {
  it("los system van juntos arriba, incluida la cola y el STRICT", () => {
    const body = toMessagesBody(
      "global.anthropic.claude-haiku-5-5",
      [
        { role: "system", content: "eres el agente" },
        { role: "user", content: "hola" },
        { role: "system", content: "cola" },
      ],
      "low"
    );
    expect(body.system).toBe("eres el agente\n\ncola");
    expect(body.messages).toEqual([{ role: "user", content: "hola" }]);
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.output_config).toEqual({ effort: "low" });
  });

  it("une turnos seguidos del mismo rol y nunca empieza ni termina con el agente", () => {
    const body = toMessagesBody(
      "global.anthropic.claude-haiku-5-5",
      [
        { role: "assistant", content: "¡Hola! ¿En qué te ayudo?" },
        { role: "user", content: "precio" },
        { role: "user", content: "del plan" },
        { role: "assistant", content: "Cuesta 100" },
      ],
      "low"
    );
    expect(body.messages).toEqual([
      { role: "user", content: "(inicio de la conversación)" },
      { role: "assistant", content: "¡Hola! ¿En qué te ayudo?" },
      { role: "user", content: "precio\n\ndel plan" },
      { role: "assistant", content: "Cuesta 100" },
      { role: "user", content: "(continúa)" },
    ]);
  });

  it("sin system no manda el campo", () => {
    const body = toMessagesBody("anthropic.claude-haiku-5-5", [{ role: "user", content: "hola" }], "medium");
    expect("system" in body).toBe(false);
  });
});

describe("fromMessagesResponse (texto y tokens)", () => {
  it("ignora el razonamiento, une el texto y suma la caché a la entrada", () => {
    const r = fromMessagesResponse({
      content: [
        { type: "thinking", text: undefined },
        { type: "text", text: '{"a":' },
        { type: "text", text: "1}" },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 2, output_tokens: 7 },
    });
    expect(r).toEqual({ content: '{"a":1}', usage: { promptTokens: 17, completionTokens: 7 } });
  });

  it("negativa del modelo o respuesta sin texto → error", () => {
    expect(() => fromMessagesResponse({ content: [{ type: "text", text: "x" }], stop_reason: "refusal" })).toThrow(/refusal/);
    expect(() => fromMessagesResponse({ content: [{ type: "thinking" }] })).toThrow(/sin contenido/);
  });
});

describe("chatJson con Claude en Bedrock", () => {
  const schema = z.object({ action: z.literal("reply"), text: z.string() });

  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("OPENROUTER_API_TOKEN", "llave-bedrock");
    vi.stubEnv("OPENROUTER_BASE_URL", "https://bedrock-runtime.us-east-1.amazonaws.com");
    vi.stubEnv("OPENROUTER_MODEL", "global.anthropic.claude-haiku-5-5");
    vi.stubEnv("OPENROUTER_JUDGE_MODEL", "global.anthropic.claude-sonnet-5-5");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function messagesResponse(text: string, usage = { input_tokens: 10, output_tokens: 3 }) {
    return new Response(JSON.stringify({ id: "msg_1", content: [{ type: "text", text }], stop_reason: "end_turn", usage }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  it("llama a /anthropic/v1/messages con x-api-key, versión y el modelo del agente", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(messagesResponse('{"action":"reply","text":"hola"}'));
    vi.stubGlobal("fetch", fetchMock);
    const result = await chatJson(schema, [
      { role: "system", content: "sistema" },
      { role: "user", content: "hola" },
    ]);
    expect(result).toMatchObject({ ok: true, data: { action: "reply", text: "hola" }, usage: { promptTokens: 10, completionTokens: 3 } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://bedrock-runtime.us-east-1.amazonaws.com/anthropic/v1/messages");
    expect(init.headers["x-api-key"]).toBe("llave-bedrock");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(init.headers.Authorization).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("global.anthropic.claude-haiku-5-5");
    expect(body.system).toBe("sistema");
    expect(body.output_config).toEqual({ effort: "low" });
  });

  it("el juez usa su modelo con esfuerzo medio", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(messagesResponse('{"action":"reply","text":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);
    await chatJson(schema, [{ role: "user", content: "evalúa" }], { judge: true });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.model).toBe("global.anthropic.claude-sonnet-5-5");
    expect(body.output_config).toEqual({ effort: "medium" });
  });

  it("salida inválida → reintenta con el STRICT en el system y suma tokens", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(messagesResponse("no soy json"))
      .mockResolvedValueOnce(messagesResponse('{"action":"reply","text":"ok"}', { input_tokens: 12, output_tokens: 4 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(true);
    expect(result.usage).toEqual({ promptTokens: 22, completionTokens: 7 });
    const second = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(second.system).toMatch(/STRICT/);
    expect(second.messages).toEqual([{ role: "user", content: "hola" }]);
  });

  it("error HTTP de Bedrock → provider_error tipado, sin lanzar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"message":"The security token included in the request is invalid."}', { status: 403 }))
    );
    vi.useFakeTimers();
    const pending = chatJson(schema, [{ role: "user", content: "hola" }]);
    await vi.runAllTimersAsync();
    const result = await pending;
    vi.useRealTimers();
    expect(result).toMatchObject({ ok: false, error: "provider_error" });
    if (!result.ok) expect(result.detail).toMatch(/403/);
  });
});
