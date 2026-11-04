import { describe, expect, it } from "vitest";
import { aiUsdRows, buildPanel } from "@/lib/platform-panel";

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

describe("aiUsdRows (0070)", () => {
  const u = (estUsd: number, usdLimit: number | null) => ({ ...usage(0, null), ai: { turns: 0, tokens: 0, limits: { turns: null, tokens: null }, estUsd, usdLimit } });
  const { rows, nearCap } = aiUsdRows([
    { id: "a", name: "A", status: "active", usage: u(1, 10) },
    { id: "b", name: "B", status: "active", usage: u(4.6, 5) },
    { id: "c", name: "C", status: "active", usage: u(9, null) },
    { id: "d", name: "D", status: "active", usage: u(0.5, null) },
    { id: "e", name: "E", status: "suspended", usage: u(99, 1) },
    { id: "f", name: "F", status: "active", usage: null },
  ]);
  it("solo activas; la más llena primero y las sin tope al final, por gasto", () => {
    expect(rows.map((r) => r.id)).toEqual(["b", "a", "c", "d", "f"]);
    expect(rows[0]).toMatchObject({ estUsd: 4.6, usdLimit: 5 });
    expect(rows[0]!.ratio).toBeCloseTo(0.92);
    expect(rows[2]!.ratio).toBeNull();
  });
  it("cuenta las que van en 80 % o más", () => expect(nearCap).toBe(1));
});
