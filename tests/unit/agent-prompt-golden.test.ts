import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";

/**
 * 031 (PR A1) — Prueba dorada del prompt del agente. La cadena de
 * `tests/fixtures/agent-prompt.golden.txt` se capturó del código ANTERIOR al
 * refactor: un agente con nombre debe producir exactamente lo mismo que hoy,
 * carácter por carácter (con y sin agenda).
 */

const FIXTURE = path.resolve(import.meta.dirname, "../fixtures/agent-prompt.golden.txt");

const now = new Date("2026-01-01T00:00:00Z");
const profile = {
  id: "agp_1",
  organizationId: "org_1",
  enabled: true,
  name: "Martillito",
  tone: "Cercano y práctico",
  instructions: "Ayuda a cotizar.\nNunca inventes existencias.",
  escalationRules: "Escala si hay queja.",
  greeting: "¡Hola! Soy Martillito",
  createdAt: now,
  updatedAt: now,
};
const kb = [
  { id: "kb_1", organizationId: "org_1", kind: "qa" as const, question: "¿Qué venden?", answer: "Clavos.", content: null, createdAt: now, updatedAt: now },
  { id: "kb_2", organizationId: "org_1", kind: "block" as const, question: null, answer: null, content: "Abrimos de 9 a 6.", createdAt: now, updatedAt: now },
];
const stages = [{ name: "Nuevo" }, { name: "Interesado" }, { name: "Ganado" }];

function render(): string {
  const sinAgenda = buildAgentSystemPrompt({ profile, kb, stages, agenda: false } as Parameters<typeof buildAgentSystemPrompt>[0]);
  const conAgenda = buildAgentSystemPrompt({ profile, kb, stages, agenda: true } as Parameters<typeof buildAgentSystemPrompt>[0]);
  return `${sinAgenda}\n=====AGENDA=====\n${conAgenda}\n`;
}

describe("prompt del agente con nombre (dorado)", () => {
  it("es idéntico al de antes del refactor", () => {
    if (!existsSync(FIXTURE) && process.env.WRITE_GOLDEN === "1") writeFileSync(FIXTURE, render());
    expect(render()).toBe(readFileSync(FIXTURE, "utf8"));
  });
});
