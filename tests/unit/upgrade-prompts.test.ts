import { describe, expect, it } from "vitest";
import { computePace, markShown, nextPlan, promptKind, shouldShowPrompt } from "@/lib/upgrade-prompts";

const d = (s: string) => new Date(s);

describe("computePace", () => {
  it("proyecta el mes y calcula cuándo llega al 100 %", () => {
    const p = computePace(50, 100, d("2026-11-11T00:00:00Z")); // 10 de 30 días
    expect(p.percent).toBe(50);
    expect(Math.round(p.projectedPercent)).toBe(150);
    expect(p.hitDate).not.toBeNull();
    expect(p.exhausted).toBe(false);
    expect(p.daysLeft).toBe(20);
  });
  it("sin gasto no hay fecha", () => {
    expect(computePace(0, 100, d("2026-11-11T00:00:00Z")).hitDate).toBeNull();
  });
  it("agotado", () => {
    expect(computePace(120, 100, d("2026-11-20T00:00:00Z")).exhausted).toBe(true);
  });
});

describe("promptKind", () => {
  const at = (spent: number, day: string) => promptKind(computePace(spent, 100, d(day)));
  it("limit al 100 %", () => expect(at(100, "2026-11-20T00:00:00Z")).toBe("limit"));
  it("pace al pasar del 80 %", () => expect(at(85, "2026-11-20T00:00:00Z")).toBe("pace"));
  it("pace por ritmo con la mitad usada y días por delante", () => expect(at(55, "2026-11-11T00:00:00Z")).toBe("pace"));
  it("nada con poco uso", () => expect(at(10, "2026-11-20T00:00:00Z")).toBeNull());
});

describe("nextPlan", () => {
  it("escalera", () => {
    expect(nextPlan("esencial")).toBe("pro");
    expect(nextPlan("pro")).toBe("ultra");
    expect(nextPlan("ultra")).toBeNull();
    expect(nextPlan("custom")).toBe("pro");
  });
});

describe("shouldShowPrompt", () => {
  const now = d("2026-11-10T12:00:00Z");
  it("primera vez, sí", () => expect(shouldShowPrompt("pace", {}, now)).toBe(true));
  it("pace una vez por semana", () => {
    const m = markShown("pace", {}, d("2026-11-08T12:00:00Z"));
    expect(shouldShowPrompt("pace", m, now)).toBe(false);
    expect(shouldShowPrompt("pace", m, d("2026-11-15T12:00:01Z"))).toBe(true);
  });
  it("limit una vez al día", () => {
    const m = markShown("limit", {}, d("2026-11-09T11:00:00Z"));
    expect(shouldShowPrompt("limit", m, now)).toBe(true);
  });
  it("«recordármelo después» silencia 3 días", () => {
    const m = markShown("limit", {}, d("2026-11-09T12:00:00Z"), true);
    expect(shouldShowPrompt("limit", m, now)).toBe(false);
    expect(shouldShowPrompt("limit", m, d("2026-11-12T12:00:01Z"))).toBe(true);
  });
  it("otro mes, memoria nueva", () => {
    const m = markShown("pace", {}, d("2026-10-30T12:00:00Z"));
    expect(shouldShowPrompt("pace", m, d("2026-11-01T12:00:00Z"))).toBe(true);
  });
});
