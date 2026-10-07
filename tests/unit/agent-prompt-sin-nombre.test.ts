import { describe, expect, it } from "vitest";
import { behaviorText, emptyConfig, toPromptConfig } from "@/server/agents/config";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";

/** 031 — Agente sin nombre de presentación: habla como el equipo del negocio. */

const kb = [{ kind: "qa" as const, question: "¿Qué venden?", answer: "Clavos.", content: null }];
const stages = [{ name: "Nuevo" }];

describe("prompt sin nombre propio", () => {
  it("no se presenta con un nombre: nunca `Eres \"`", () => {
    const p = buildAgentSystemPrompt({ config: toPromptConfig(emptyConfig()), kb, stages });
    expect(p).not.toContain('Eres "');
    expect(p.split("\n")[0]).toBe(
      "Eres el asistente de WhatsApp de este negocio. No tienes nombre propio: no te presentes con uno y habla como el equipo del negocio. Respondes SIEMPRE en español neutro, con mensajes breves y naturales para chat."
    );
    // Todo lo demás, igual que con nombre.
    const conNombre = buildAgentSystemPrompt({ config: { ...toPromptConfig(emptyConfig()), name: "Sofi" }, kb, stages });
    expect(p.split("\n").slice(1)).toEqual(conNombre.split("\n").slice(1));
  });

  it("con nombre: la primera línea de siempre", () => {
    const p = buildAgentSystemPrompt({ config: { ...toPromptConfig(emptyConfig()), name: "Sofi" }, kb, stages });
    expect(p.startsWith('Eres "Sofi", el asistente de WhatsApp de este negocio.')).toBe(true);
  });

  it("el juez lo ve como «(sin nombre propio)»", () => {
    expect(behaviorText(toPromptConfig(emptyConfig()))).toBe("Nombre: (sin nombre propio)");
    expect(behaviorText({ ...toPromptConfig(emptyConfig()), name: "Sofi", tone: "Cálido" })).toBe("Nombre: Sofi\nTono: Cálido");
  });
});
