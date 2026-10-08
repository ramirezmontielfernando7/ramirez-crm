import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { docScopeFor, normalizeDocSources, sameDocSources, scopeAllows } from "@/lib/kb-docs";
import { agentConfigSchema, emptyConfig, parseStoredConfig, sameConfig } from "@/server/agents/config";

/** 037 (PR 2) — De qué documentos lee cada agente. */
describe("037 — docSources en la config del agente", () => {
  it("una config guardada antes de 037 (sin docSources) se lee como «todos»", () => {
    const vieja = { v: 1, displayName: null, tone: null, greeting: null, instructions: "x", escalationRules: null, useSharedKb: true };
    expect(parseStoredConfig(vieja)?.docSources).toEqual({ mode: "all" });
  });

  it("un valor roto guardado también se lee como «todos» (el turno no muere)", () => {
    expect(parseStoredConfig({ ...emptyConfig(), docSources: { mode: "raro" } })?.docSources).toEqual({ mode: "all" });
    expect(parseStoredConfig({ ...emptyConfig(), docSources: "todos" })?.docSources).toEqual({ mode: "all" });
  });

  it("al escribir: ausente = todos; los grupos quedan sin repetidos y en orden", () => {
    expect(agentConfigSchema.parse({ displayName: null }).docSources).toEqual({ mode: "all" });
    const c = agentConfigSchema.parse({ displayName: null, docSources: { mode: "groups", groupIds: ["kdg_b", "general", "kdg_b"] } });
    expect(c.docSources).toEqual({ mode: "groups", groupIds: ["general", "kdg_b"] });
  });

  it("al escribir: un modo desconocido o demasiados grupos se rechazan", () => {
    expect(agentConfigSchema.safeParse({ displayName: null, docSources: { mode: "raro" } }).success).toBe(false);
    const muchos = Array.from({ length: 30 }, (_, i) => `kdg_${i}`);
    expect(agentConfigSchema.safeParse({ displayName: null, docSources: { mode: "groups", groupIds: muchos } }).success).toBe(false);
  });

  it("sameConfig compara la selección sin importar el orden (borrador vs publicado)", () => {
    const a = { ...emptyConfig(), docSources: { mode: "groups" as const, groupIds: ["kdg_a", "kdg_b"] } };
    const b = { ...emptyConfig(), docSources: { mode: "groups" as const, groupIds: ["kdg_b", "kdg_a"] } };
    expect(sameConfig(a, b)).toBe(true);
    expect(sameConfig(a, emptyConfig())).toBe(false);
    expect(sameDocSources({ mode: "groups", groupIds: [] }, { mode: "all" })).toBe(false);
    expect(normalizeDocSources({ mode: "all" })).toEqual({ mode: "all" });
  });
});

describe("037 — quién lee qué (la regla de scopeCondition)", () => {
  const general = { groupId: null, agentId: null };
  const ventas = { groupId: "kdg_v", agentId: null };
  const deA = { groupId: null, agentId: "agt_a" };
  const deB = { groupId: null, agentId: "agt_b" };

  it("sin configurar (todos): todo lo de la empresa, más lo propio; nunca lo de otro agente", () => {
    const s = docScopeFor("agt_a", undefined);
    expect([general, ventas, deA, deB].map((d) => scopeAllows(s, d))).toEqual([true, true, true, false]);
  });

  it("solo Ventas: Ventas y lo propio; ni General ni lo de otro", () => {
    const s = docScopeFor("agt_a", { mode: "groups", groupIds: ["kdg_v"] });
    expect([general, ventas, deA, deB].map((d) => scopeAllows(s, d))).toEqual([false, true, true, false]);
  });

  it("solo General", () => {
    const s = docScopeFor("agt_a", { mode: "groups", groupIds: ["general"] });
    expect([general, ventas, deA, deB].map((d) => scopeAllows(s, d))).toEqual([true, false, true, false]);
  });

  it("sin grupos elegidos: solo lo propio", () => {
    const s = docScopeFor("agt_a", { mode: "groups", groupIds: [] });
    expect([general, ventas, deA, deB].map((d) => scopeAllows(s, d))).toEqual([false, false, true, false]);
  });

  it("sin agente (agentId null): jamás un exclusivo", () => {
    const s = docScopeFor(null, undefined);
    expect([general, ventas, deA].map((d) => scopeAllows(s, d))).toEqual([true, true, false]);
  });
});

describe("037 — guardarraíl: cada recuperación lleva las fuentes del agente", () => {
  const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
  it("el turno y la vista previa llaman a retrieveForTurn con docScopeFor", () => {
    for (const f of ["server/ai/pipeline.ts", "server/agents/preview.ts"]) {
      const src = readFileSync(path.join(SRC, f), "utf8");
      const calls = src.match(/retrieveForTurn\([^)]*\)/g) ?? [];
      expect(calls.length, f).toBeGreaterThan(0);
      for (const c of calls) expect(c, f).toMatch(/docScopeFor\(/);
    }
  });
});
