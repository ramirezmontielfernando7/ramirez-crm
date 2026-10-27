import { describe, expect, it } from "vitest";
import { buildPanel } from "@/lib/platform-panel";

const usage = (tokens: number, limit: number | null, storage = 0, storageLimit: number | null = null) => ({
  ai: { turns: 1, tokens, limits: { turns: null, tokens: limit } },
  storageBytes: storage,
  plan: { storageLimitBytes: storageLimit },
  alerts: [],
});

describe("buildPanel", () => {
  const orgs = [
    { id: "a", name: "A", status: "active" as const, usage: usage(900, 1000, 100, 1000) },
    { id: "b", name: "B", status: "active" as const, usage: usage(100, 1000, 50) },
    { id: "c", name: "C", status: "active" as const, usage: usage(500, null) },
    { id: "d", name: "D", status: "suspended" as const, usage: usage(9999, 1000) },
    { id: "e", name: "E", status: "deleted" as const, usage: null },
  ];
  const p = buildPanel(orgs);

  it("cuenta por estado", () => expect(p.byStatus).toEqual({ active: 3, suspended: 1, deleted: 1 }));
  it("suma solo las activas", () => {
    expect(p.ai.tokens).toBe(1500);
    expect(p.ai.assignedTokens).toBe(2000);
    expect(p.ai.assignedTurns).toBeNull();
    expect(p.ai.withoutLimit).toBe(1);
    expect(p.storageBytes).toBe(150);
  });
  it("marca las cercanas al tope, la más llena primero", () => {
    expect(p.nearLimit.map((n) => n.id + n.kind)).toEqual(["aia"]);
  });
  it("ordena el mayor consumo", () => expect(p.topAi.map((t) => t.id)).toEqual(["a", "c", "b"]));
});
