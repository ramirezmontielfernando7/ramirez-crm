import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { chatJson } from "@/lib/ai";
import { bedrockOpenAiUrl, isBedrockOpenAiModel } from "@/lib/ai/bedrock-openai";
import { defaultUseOfKind, envChoice, functionOfUse, parseEffort } from "@/lib/ai/choice";

const env = (o: Record<string, string | undefined>) => o as never;

describe("modelo y esfuerzo por función (variables de entorno)", () => {
  it("agentes: OPENROUTER_MODEL con esfuerzo bajo, o el de AI_AGENT_EFFORT", () => {
    expect(envChoice("agent", env({ OPENROUTER_MODEL: "haiku" }))).toEqual({ model: "haiku", effort: "low" });
    expect(envChoice("agent", env({ OPENROUTER_MODEL: "luna", AI_AGENT_EFFORT: "none" }))).toEqual({ model: "luna", effort: "none" });
    // La redacción va con los agentes.
    expect(envChoice("writing", env({ OPENROUTER_MODEL: "haiku", AI_AGENT_EFFORT: "medium" }))).toEqual({ model: "haiku", effort: "medium" });
    // Un esfuerzo mal escrito no rompe: se queda en bajo.
    expect(envChoice("agent", env({ OPENROUTER_MODEL: "haiku", AI_AGENT_EFFORT: "altisimo" })).effort).toBe("low");
  });

  it("creador: su variable → juez → principal; el juez usa el del creador", () => {
    expect(envChoice("creator", env({ OPENROUTER_MODEL: "m", OPENROUTER_CREATOR_MODEL: "terra", AI_CREATOR_EFFORT: "medium" }))).toEqual({ model: "terra", effort: "medium" });
    expect(envChoice("creator", env({ OPENROUTER_MODEL: "m", OPENROUTER_JUDGE_MODEL: "juez" })).model).toBe("juez");
    expect(envChoice("creator", env({ OPENROUTER_MODEL: "m" })).model).toBe("m");
    expect(envChoice("judge", env({ OPENROUTER_MODEL: "m", OPENROUTER_CREATOR_MODEL: "terra" })).model).toBe("terra");
  });

  it("asistente: un modelo y los modos dan el esfuerzo (bajo, medio, alto)", () => {
    const e = env({ OPENROUTER_MODEL: "m", ASSISTANT_MODEL: "sonnet", ASSISTANT_MODEL_FAST: "viejo" });
    expect(envChoice("assistant", e, "fast")).toEqual({ model: "sonnet", effort: "low" });
    expect(envChoice("assistant", e, "normal")).toEqual({ model: "sonnet", effort: "medium" });
    expect(envChoice("assistant", e, "deep")).toEqual({ model: "sonnet", effort: "high" });
    // El análisis de chats: el modelo del asistente, con esfuerzo bajo.
    expect(envChoice("analysis", e)).toEqual({ model: "sonnet", effort: "low" });
  });

  it("sin ASSISTANT_MODEL se respeta la cadena de antes (nada cambia solo)", () => {
    const e = env({ OPENROUTER_MODEL: "m", ASSISTANT_MODEL_FAST: "haiku", ASSISTANT_MODEL_NORMAL: "sonnet", ASSISTANT_MODEL_DEEP: "opus", OPENROUTER_ANALYSIS_MODEL: "an" });
    expect(envChoice("assistant", e, "fast").model).toBe("haiku");
    expect(envChoice("assistant", e, "normal").model).toBe("sonnet");
    expect(envChoice("assistant", e, "deep").model).toBe("opus");
    expect(envChoice("analysis", e).model).toBe("an");
    expect(envChoice("assistant", env({ OPENROUTER_MODEL: "m" }), "fast").model).toBe("m");
    expect(envChoice("assistant", env({ OPENROUTER_MODEL: "m", OPENROUTER_JUDGE_MODEL: "j" }), "normal").model).toBe("j");
  });

  it("cada tipo de cuota cae en su función", () => {
    expect(defaultUseOfKind("lab")).toBe("agent");
    expect(defaultUseOfKind("judge")).toBe("judge");
    expect(functionOfUse(defaultUseOfKind("analysis"))).toBe("assistant");
    expect(functionOfUse("writing")).toBe("agent");
    expect(parseEffort(" HIGH ")).toBe("high");
    expect(parseEffort("")).toBeUndefined();
  });
});

describe("GPT dentro de Amazon Bedrock", () => {
  it("se reconoce por el nombre del modelo", () => {
    expect(isBedrockOpenAiModel("global.openai.gpt-6-luna")).toBe(true);
    expect(isBedrockOpenAiModel("us.openai.gpt-6.1-terra")).toBe(true);
    expect(isBedrockOpenAiModel("openai.gpt-oss-120b")).toBe(true);
    expect(isBedrockOpenAiModel("openai/gpt-5-mini")).toBe(false);
    expect(isBedrockOpenAiModel("gpt-5-mini")).toBe(false);
    expect(isBedrockOpenAiModel("global.anthropic.claude-haiku-5-5")).toBe(false);
  });

  it("ruta: /openai/v1 en bedrock-runtime (la misma base que Claude); /v1 en mantle", () => {
    expect(bedrockOpenAiUrl("https://bedrock-runtime.us-east-1.amazonaws.com/")).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions"
    );
    expect(bedrockOpenAiUrl("https://bedrock-mantle.us-east-1.api.aws")).toBe("https://bedrock-mantle.us-east-1.api.aws/v1/chat/completions");
  });

  describe("chatJson", () => {
    const schema = z.object({ ok: z.boolean() });
    beforeEach(() => {
      vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
      vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
      vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
      vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
      vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
      vi.stubEnv("OPENROUTER_API_TOKEN", "llave-bedrock");
      vi.stubEnv("OPENROUTER_BASE_URL", "https://bedrock-runtime.us-east-1.amazonaws.com");
      vi.stubEnv("OPENROUTER_MODEL", "global.anthropic.claude-haiku-5-5");
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });
    const completion = (content: string) =>
      new Response(JSON.stringify({ id: "c1", choices: [{ message: { content } }], usage: { prompt_tokens: 20, completion_tokens: 5 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    it("va por /openai/v1/chat/completions con la llave en Bearer y su esfuerzo", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(completion('{"ok":true}'));
      vi.stubGlobal("fetch", fetchMock);
      const r = await chatJson(schema, [{ role: "user", content: "hola" }], { model: "global.openai.gpt-6.1-terra", effort: "none" });
      expect(r).toMatchObject({ ok: true, model: "global.openai.gpt-6.1-terra", usage: { promptTokens: 20, completionTokens: 5 } });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions");
      expect(init.headers.Authorization).toBe("Bearer llave-bedrock");
      const body = JSON.parse(init.body as string);
      expect(body).toMatchObject({ model: "global.openai.gpt-6.1-terra", reasoning_effort: "none", max_completion_tokens: 8192 });
      expect(body.max_tokens).toBeUndefined();
    });

    it("Claude recibe el esfuerzo alto; «sin razonamiento» se vuelve bajo", async () => {
      const msg = () =>
        new Response(JSON.stringify({ content: [{ type: "text", text: '{"ok":true}' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
      const fetchMock = vi.fn().mockResolvedValueOnce(msg()).mockResolvedValueOnce(msg());
      vi.stubGlobal("fetch", fetchMock);
      await chatJson(schema, [{ role: "user", content: "a" }], { effort: "high" });
      await chatJson(schema, [{ role: "user", content: "b" }], { effort: "none" });
      expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).output_config).toEqual({ effort: "high" });
      expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string).output_config).toEqual({ effort: "low" });
    });
  });
});
