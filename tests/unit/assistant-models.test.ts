import { describe, expect, it } from "vitest";
import { assistantModelFor } from "@/server/assistant/engine";

const env = (o: Record<string, string | undefined>) => o as never;

describe("modelo por modo del asistente (variables ASSISTANT_MODEL_*)", () => {
  it("sin variables: rápido = el principal; normal y profundo = análisis → juez", () => {
    expect(assistantModelFor("fast", env({}))).toBeUndefined();
    expect(assistantModelFor("normal", env({}))).toBeUndefined();
    expect(assistantModelFor("normal", env({ OPENROUTER_JUDGE_MODEL: "juez" }))).toBe("juez");
    expect(assistantModelFor("normal", env({ OPENROUTER_ANALYSIS_MODEL: "analisis", OPENROUTER_JUDGE_MODEL: "juez" }))).toBe("analisis");
    expect(assistantModelFor("deep", env({ OPENROUTER_JUDGE_MODEL: "juez" }))).toBe("juez");
  });

  it("con variables propias, cada modo usa la suya", () => {
    const e = env({ ASSISTANT_MODEL_FAST: "haiku", ASSISTANT_MODEL_NORMAL: "sonnet", ASSISTANT_MODEL_DEEP: "opus", OPENROUTER_ANALYSIS_MODEL: "x" });
    expect(assistantModelFor("fast", e)).toBe("haiku");
    expect(assistantModelFor("normal", e)).toBe("sonnet");
    expect(assistantModelFor("deep", e)).toBe("opus");
  });
});
