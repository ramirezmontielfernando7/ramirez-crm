import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * 036 (PR 1) — `chatJsonForOrg` anota el turno al agente que lo pidió
 * (`ai_usage_agent`) sin cambiar nada de lo demás: solo turnos contados, solo
 * tipos con agente, y un fallo al anotar jamás tumba el turno.
 */

const m = vi.hoisted(() => ({
  chatJson: vi.fn(),
  reserveTurn: vi.fn(),
  recordUsage: vi.fn(),
  recordAgentUsage: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({ chatJson: m.chatJson }));
vi.mock("@/server/ai-quota/quota", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/ai-quota/quota")>();
  return {
    ...original,
    reserveTurn: m.reserveTurn,
    recordUsage: m.recordUsage,
    recordAgentUsage: m.recordAgentUsage,
  };
});

import { chatJsonForOrg } from "@/server/ai-quota/llm";
import { isAgentKind } from "@/server/ai-quota/quota";

const S = z.object({ ok: z.boolean() });
const USAGE = { promptTokens: 120, completionTokens: 30 };

describe("chatJsonForOrg: consumo por agente", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_TOKEN = "sk-test";
    m.chatJson.mockResolvedValue({ ok: true, data: { ok: true }, raw: "{}", usage: USAGE });
    m.reserveTurn.mockResolvedValue({ ok: true });
    m.recordUsage.mockResolvedValue(undefined);
    m.recordAgentUsage.mockResolvedValue(undefined);
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_TOKEN;
    vi.clearAllMocks();
  });

  it("con agente: suma al total/tipo y al agente, y el agentId no viaja al proveedor", async () => {
    const r = await chatJsonForOrg("org_a", "agent", S, [], { agentId: "agt_1", timeoutMs: 5 });
    expect(r.ok).toBe(true);
    expect(m.recordUsage).toHaveBeenCalledWith("org_a", "agent", USAGE);
    expect(m.recordAgentUsage).toHaveBeenCalledWith("org_a", "agt_1", "agent", USAGE);
    expect(m.chatJson.mock.calls[0]![2]).toEqual({ timeoutMs: 5 });
  });

  it("lab y judge también se anotan al agente", async () => {
    await chatJsonForOrg("org_a", "lab", S, [], { agentId: "agt_1" });
    await chatJsonForOrg("org_a", "judge", S, [], { agentId: "agt_1", judge: true });
    expect(m.recordAgentUsage.mock.calls.map((c) => c[2])).toEqual(["lab", "judge"]);
  });

  it("sin agente (la escritura) no se anota a nadie", async () => {
    await chatJsonForOrg("org_a", "writing", S, []);
    expect(m.recordUsage).toHaveBeenCalledTimes(1);
    expect(m.recordAgentUsage).not.toHaveBeenCalled();
  });

  it("un tipo sin agente no se anota aunque alguien pase agentId", async () => {
    await chatJsonForOrg("org_a", "writing", S, [], { agentId: "agt_1" });
    expect(m.recordAgentUsage).not.toHaveBeenCalled();
  });

  it("el proveedor falla sin tokens: el turno igual cuenta para el agente (como en ai_usage)", async () => {
    m.chatJson.mockResolvedValue({ ok: false, error: "provider_error", detail: "x" });
    const r = await chatJsonForOrg("org_a", "agent", S, [], { agentId: "agt_1" });
    expect(r.ok).toBe(false);
    expect(m.recordUsage).not.toHaveBeenCalled();
    expect(m.recordAgentUsage).toHaveBeenCalledWith("org_a", "agt_1", "agent", null);
  });

  it("si falla al anotar al agente, el turno sigue con su resultado", async () => {
    m.recordAgentUsage.mockRejectedValue(new Error("FK: el agente ya no existe"));
    const r = await chatJsonForOrg("org_a", "agent", S, [], { agentId: "agt_x" });
    expect(r).toMatchObject({ ok: true, data: { ok: true } });
  });

  it("si no se pudo reservar (BD caída), la llamada sigue y no se anota nada", async () => {
    m.reserveTurn.mockRejectedValue(new Error("bd caída"));
    const r = await chatJsonForOrg("org_a", "agent", S, [], { agentId: "agt_1" });
    expect(r.ok).toBe(true);
    expect(m.recordUsage).not.toHaveBeenCalled();
    expect(m.recordAgentUsage).not.toHaveBeenCalled();
  });

  it("con la cuota agotada no se llama al modelo ni se anota al agente", async () => {
    m.reserveTurn.mockResolvedValue({ ok: false, limit: "turns" });
    const r = await chatJsonForOrg("org_a", "agent", S, [], { agentId: "agt_1" });
    expect(r).toMatchObject({ ok: false, error: "quota_exceeded" });
    expect(m.chatJson).not.toHaveBeenCalled();
    expect(m.recordAgentUsage).not.toHaveBeenCalled();
  });

  it("sin proveedor no hay nada que contar y el agentId tampoco viaja", async () => {
    delete process.env.OPENROUTER_API_TOKEN;
    await chatJsonForOrg("org_a", "agent", S, [], { agentId: "agt_1" });
    expect(m.reserveTurn).not.toHaveBeenCalled();
    expect(m.chatJson.mock.calls[0]![2]).toEqual({});
  });

  it("isAgentKind: agent, lab y judge sí; writing y embed no", () => {
    expect(["agent", "lab", "judge", "writing", "embed", "total"].filter(isAgentKind)).toEqual(["agent", "lab", "judge"]);
  });
});
