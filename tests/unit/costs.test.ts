import { describe, expect, it } from "vitest";
import {
  costByKind,
  estimateKindUsd,
  formatLocal,
  formatUsd,
  monthElapsed,
  periodBounds,
  pricingAt,
  pricingMomentFor,
  projectionBase,
  projectMonth,
  sumCosts,
  type Pricing,
} from "@/lib/costs";

/** 036 (PR 3b) — Reglas puras del panel de costos. */

function precio(over: Partial<Pricing> = {}): Pricing {
  return {
    id: "aip_1",
    validFrom: "2026-10-01T00:00:00.000Z",
    chatInputUsdPerMtok: 3,
    chatOutputUsdPerMtok: 15,
    judgeInputUsdPerMtok: null,
    judgeOutputUsdPerMtok: null,
    embedUsdPerMtok: 0.02,
    usdToLocal: 18.5,
    localCurrency: "MXN",
    createdAt: "2026-10-01T00:00:00.000Z",
    createdByEmail: null,
    ...over,
  };
}

describe("estimado", () => {
  it("entrada y salida a su precio por millón; el juez sin precio propio usa el principal", () => {
    const p = precio();
    expect(estimateKindUsd("agent", 1_000_000, 100_000, p)).toBeCloseTo(3 + 1.5);
    expect(estimateKindUsd("judge", 1_000_000, 0, p)).toBeCloseTo(3);
    expect(estimateKindUsd("judge", 1_000_000, 0, precio({ judgeInputUsdPerMtok: 1 }))).toBeCloseTo(1);
    expect(estimateKindUsd("embed", 2_000_000, 0, p)).toBeCloseTo(0.04);
    expect(estimateKindUsd("agent", 10, 10, null)).toBeNull();
  });

  it("desglose por función sin la fila total; real nulo si nadie reportó", () => {
    const rows = [
      { kind: "total", promptTokens: 1_100_000, completionTokens: 0, costUsd: 3.3 },
      { kind: "agent", promptTokens: 1_000_000, completionTokens: 0, costUsd: 3 },
      { kind: "writing", promptTokens: 100_000, completionTokens: 0, costUsd: 0.3 },
      { kind: "embed", promptTokens: 1_000_000, completionTokens: 0, costUsd: 0 },
    ];
    const k = costByKind(rows, precio());
    expect(k.map((x) => x.kind)).toEqual(["agent", "writing", "embed"]);
    const t = sumCosts(k, true);
    expect(t.estimatedUsd).toBeCloseTo(3 + 0.3 + 0.02);
    expect(t.realUsd).toBeCloseTo(3.3);
    expect(sumCosts(costByKind([{ kind: "agent", promptTokens: 5, completionTokens: 0, costUsd: 0 }], null), false)).toEqual({
      estimatedUsd: null,
      realUsd: null,
    });
  });
});

describe("historial «vigente desde»", () => {
  const h = [
    precio({ id: "a", validFrom: "2026-09-01T00:00:00.000Z" }),
    precio({ id: "b", validFrom: "2026-10-15T00:00:00.000Z" }),
    precio({ id: "c", validFrom: "2026-12-01T00:00:00.000Z" }), // futuro
  ];
  it("rige el más reciente que no es futuro", () => {
    expect(pricingAt(h, new Date("2026-10-10T00:00:00Z"))?.id).toBe("a");
    expect(pricingAt(h, new Date("2026-10-20T00:00:00Z"))?.id).toBe("b");
    expect(pricingAt(h, new Date("2026-08-01T00:00:00Z"))).toBeNull();
  });
  it("un mes cerrado se estima con el precio de su último instante", () => {
    const at = pricingMomentFor("2026-09-01", new Date("2026-11-03T00:00:00Z"));
    expect(at.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    expect(pricingAt(h, at)?.id).toBe("a");
  });
});

describe("proyección del mes (UTC)", () => {
  it("lo gastado ÷ lo que va del mes; al menos un día; mes cerrado = lo gastado", () => {
    expect(periodBounds("2026-02-01").end.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    // 10 de 31 días de octubre
    expect(monthElapsed("2026-10-01", new Date("2026-10-11T00:00:00Z"))).toBeCloseTo(10 / 31);
    expect(projectMonth(10, "2026-10-01", new Date("2026-10-11T00:00:00Z"))).toBeCloseTo(31);
    // la primera hora del mes cuenta como un día
    expect(projectMonth(1, "2026-10-01", new Date("2026-10-01T01:00:00Z"))).toBeCloseTo(31);
    expect(projectMonth(5, "2026-09-01", new Date("2026-10-11T00:00:00Z"))).toBe(5);
    expect(projectMonth(null, "2026-10-01")).toBeNull();
  });
});

describe("base de la proyección", () => {
  it("el mayor entre estimado y real; sin ninguno, nada", () => {
    expect(projectionBase({ estimatedUsd: 2, realUsd: 0.5 })).toBe(2); // real parcial (antes del despliegue)
    expect(projectionBase({ estimatedUsd: 1, realUsd: 3 })).toBe(3); // precios capturados de menos
    expect(projectionBase({ estimatedUsd: null, realUsd: 3 })).toBe(3);
    expect(projectionBase({ estimatedUsd: null, realUsd: null })).toBeNull();
  });
});

describe("formato", () => {
  it("USD y moneda local; montos chicos con 4 decimales", () => {
    expect(formatUsd(12.5)).toBe("12.50 USD");
    expect(formatUsd(0.0123)).toBe("0.0123 USD");
    expect(formatUsd(null)).toBe("—");
    expect(formatLocal(10, precio())).toBe("185.00 MXN");
    expect(formatLocal(10, null)).toBe("—");
  });
});
