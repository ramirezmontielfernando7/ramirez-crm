import { describe, expect, it } from "vitest";
import { capUsd, checkCaps } from "@/lib/fn-caps";

describe("0072 — reparto por función", () => {
  it("el porcentaje sigue al total; dólares y tokens ya vienen convertidos", () => {
    expect(capUsd({ unit: "pct", value: 20, usd: null }, 2)).toBeCloseTo(0.4);
    expect(capUsd({ unit: "pct", value: 20, usd: null }, 10)).toBeCloseTo(2);
    expect(capUsd({ unit: "usd", value: 0.5, usd: 0.5 }, 2)).toBe(0.5);
    expect(capUsd({ unit: "pct", value: 20, usd: null }, null)).toBeNull();
    expect(capUsd({ unit: "usd", value: null, usd: null }, 2)).toBeNull();
  });
  it("la suma no puede pasar del total", () => {
    const ok = checkCaps([{ unit: "pct", value: 50, usd: null }, { unit: "pct", value: 20, usd: null }], 2);
    expect(ok).toMatchObject({ ok: true, pct: 70 });
    const mal = checkCaps([{ unit: "pct", value: 80, usd: null }, { unit: "usd", value: 0.8, usd: 0.8 }], 2);
    expect(mal).toMatchObject({ ok: false, code: "suma_excede", pct: 120 });
    expect(mal.ok === false && mal.message).toContain("120 %");
  });
  it("un porcentaje sin total se rechaza; dólares sin total se aceptan; vacío no cuenta", () => {
    expect(checkCaps([{ unit: "pct", value: 10, usd: null }], null)).toMatchObject({ ok: false, code: "pct_sin_total" });
    expect(checkCaps([{ unit: "usd", value: 1, usd: 1 }], null).ok).toBe(true);
    expect(checkCaps([{ unit: "pct", value: null, usd: null }], null).ok).toBe(true);
  });
});
