import { describe, expect, it } from "vitest";
import { emptyConfig, toPromptConfig } from "@/server/agents/config";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { aiMockCompletion } from "@/server/dev/ai-mock";

/** 031 — El ai-mock dice qué agente contestó, con nombre o sin él. */

function pregunta(name: string | null) {
  const system = buildAgentSystemPrompt({ config: { ...toPromptConfig(emptyConfig()), name }, kb: [], stages: [{ name: "Nuevo" }] });
  return JSON.parse(aiMockCompletion([{ role: "system", content: system }, { role: "user", content: "hola, ¿quién eres?" }]));
}

describe("ai-mock: identidad del agente", () => {
  it("con nombre", () => {
    expect(pregunta("Vale")).toEqual({ action: "reply", text: "Soy Vale." });
  });
  it("sin nombre", () => {
    expect(pregunta(null)).toEqual({ action: "reply", text: "Somos el equipo del negocio (sin nombre propio)." });
  });
  it("lo demás no cambia", () => {
    const system = buildAgentSystemPrompt({ config: toPromptConfig(emptyConfig()), kb: [], stages: [{ name: "Nuevo" }] });
    expect(JSON.parse(aiMockCompletion([{ role: "system", content: system }, { role: "user", content: "lo compro" }])).action).toBe("move_stage");
  });
});
