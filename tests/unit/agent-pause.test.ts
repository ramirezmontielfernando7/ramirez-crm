import { describe, expect, it } from "vitest";
import { pauseScope, rowAiBadge, turnIsPaused } from "@/lib/agent-pause";

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

describe("fila de la Bandeja: ícono del bot", () => {
  const base = { aiAvailable: true, aiEnabled: true, handoffAt: null, orgPaused: false };

  it("el agente atiende: ícono normal", () => {
    expect(rowAiBadge(base)).toBe("on");
  });
  it("agente apagado: sin ícono", () => {
    expect(rowAiBadge({ ...base, aiAvailable: false })).toBe("none");
  });
  it("solo ese chat en pausa o en traspaso: ícono tenue", () => {
    expect(rowAiBadge({ ...base, aiEnabled: false })).toBe("paused");
    expect(rowAiBadge({ ...base, handoffAt: "2026-01-01T00:00:00Z" })).toBe("paused");
  });
  it("pausa general: sin ícono en la fila, aunque el chat siga activo o en traspaso", () => {
    expect(rowAiBadge({ ...base, orgPaused: true })).toBe("none");
    expect(rowAiBadge({ ...base, orgPaused: true, handoffAt: "2026-01-01T00:00:00Z" })).toBe("none");
  });
});
