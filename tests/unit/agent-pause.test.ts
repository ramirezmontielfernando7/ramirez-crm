import { describe, expect, it } from "vitest";
import { pauseScope, turnIsPaused } from "@/lib/agent-pause";

const now = new Date();

describe("042 — regla de los interruptores de agentes", () => {
  it("sin ningún interruptor, el agente atiende", () => {
    const s = { orgPausedAt: null, agentPausedAt: null };
    expect(pauseScope(s)).toBeNull();
    expect(turnIsPaused(s, false)).toBe(false);
  });

  it("la pausa general detiene a cualquier agente", () => {
    const s = { orgPausedAt: now, agentPausedAt: null };
    expect(pauseScope(s)).toBe("org");
    expect(turnIsPaused(s, false)).toBe(true);
  });

  it("el interruptor de un agente detiene solo a ese agente", () => {
    const s = { orgPausedAt: null, agentPausedAt: now };
    expect(pauseScope(s)).toBe("agent");
    expect(turnIsPaused(s, false)).toBe(true);
  });

  it("si están los dos, manda la general", () => {
    expect(pauseScope({ orgPausedAt: now, agentPausedAt: now })).toBe("org");
  });

  it("el Laboratorio (chat de prueba) nunca se pausa", () => {
    expect(turnIsPaused({ orgPausedAt: now, agentPausedAt: now }, true)).toBe(false);
  });
});
