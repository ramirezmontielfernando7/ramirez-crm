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
  capacityCost,
  hasExchangeRate,
  parseOpenRouterPrice,
  suggestedPriceFor,
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
    analysisInputUsdPerMtok: null,
    analysisOutputUsdPerMtok: null,
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

describe("tipo de cambio opcional", () => {
  it("sin tipo de cambio no hay moneda local y nada se rompe", () => {
    const p = precio({ usdToLocal: null });
    expect(hasExchangeRate(p)).toBe(false);
    expect(formatLocal(12.5, p)).toBe("—");
    expect(formatUsd(12.5)).toContain("USD");
    expect(estimateKindUsd("agent", 1_000_000, 0, p)).toBeCloseTo(3);
    const kinds = costByKind([{ kind: "agent", promptTokens: 1_000_000, completionTokens: 0, costUsd: 0 }], p);
    expect(sumCosts(kinds, true).estimatedUsd).toBeCloseTo(3);
  });
  it("con tipo de cambio convierte", () => {
    expect(hasExchangeRate(precio())).toBe(true);
    expect(formatLocal(2, precio())).toMatch(/37[.,]00 MXN/);
  });
});

describe("precios sugeridos y de OpenRouter", () => {
  it("modelos conocidos", () => {
    expect(suggestedPriceFor("global.anthropic.claude-haiku-5-5")).toMatchObject({ inputUsdPerMtok: 0.1, outputUsdPerMtok: 0.5 });
    expect(suggestedPriceFor("anthropic/claude-sonnet-5.5")).toMatchObject({ inputUsdPerMtok: 2, outputUsdPerMtok: 10 });
    expect(suggestedPriceFor("global.openai.gpt-6-luna")).toMatchObject({ inputUsdPerMtok: 0.1 });
    expect(suggestedPriceFor("algo/desconocido")).toBeNull();
    expect(suggestedPriceFor(null)).toBeNull();
  });
  it("OpenRouter da USD por token: sale por millón", () => {
    const json = { data: [{ id: "a/b", pricing: { prompt: "0.0000001", completion: "0.0000005" } }, { id: "c/d", pricing: { prompt: "x", completion: "1" } }] };
    expect(parseOpenRouterPrice(json, "a/b")).toMatchObject({ inputUsdPerMtok: 0.1, outputUsdPerMtok: 0.5 });
    expect(parseOpenRouterPrice(json, "c/d")).toBeNull();
    expect(parseOpenRouterPrice(json, "no/existe")).toBeNull();
    expect(parseOpenRouterPrice({}, "a/b")).toBeNull();
  });
});

describe("calculadora de costo máximo por cliente", () => {
  const p = precio({
    chatInputUsdPerMtok: 0.1,
    chatOutputUsdPerMtok: 0.5,
    judgeInputUsdPerMtok: 2,
    judgeOutputUsdPerMtok: 10,
    analysisInputUsdPerMtok: 2,
    analysisOutputUsdPerMtok: 10,
    embedUsdPerMtok: 0.02,
  });
  it("todo el tope de chat al peor precio; asistente dentro del total; embeddings aparte", () => {
    // 100 % entrada: principal 0.1, juez 2, análisis 2. Chat: 8M × 2 (peor caso juez), asistente 2M × 2, embeddings 5M × 0.02.
    const c = capacityCost({ aiTurns: 1000, aiTokens: 10_000_000, assistantTokens: 2_000_000, embedTokens: 5_000_000 }, p, 1);
    expect(c.chatUsd).toBeCloseTo(16);
    expect(c.assistantUsd).toBeCloseTo(4);
    expect(c.embedUsd).toBeCloseTo(0.1);
    expect(c.totalUsd).toBeCloseTo(20.1);
    expect(c.unbounded).toBe(false);
  });
  it("la proporción entrada/salida mueve el costo", () => {
    const l = { aiTurns: null, aiTokens: 1_000_000, assistantTokens: null, embedTokens: 0 };
    expect(capacityCost(l, p, 1).totalUsd).toBeCloseTo(2);
    expect(capacityCost(l, p, 0).totalUsd).toBeCloseTo(10);
    expect(capacityCost(l, p, 0.5).totalUsd).toBeCloseTo(6);
  });
  it("sin tope de tokens no hay techo; sin tope del asistente no responde (0)", () => {
    const c = capacityCost({ aiTurns: null, aiTokens: null, assistantTokens: null, embedTokens: null }, p, 0.8);
    expect(c.totalUsd).toBeNull();
    expect(c.unbounded).toBe(true);
    const d = capacityCost({ aiTurns: null, aiTokens: 1_000_000, assistantTokens: null, embedTokens: 0 }, p, 1);
    expect(d.assistantUsd).toBe(0);
  });
  it("el tope del asistente nunca pasa del total", () => {
    const c = capacityCost({ aiTurns: null, aiTokens: 1_000_000, assistantTokens: 5_000_000, embedTokens: 0 }, p, 1);
    expect(c.assistantUsd).toBeCloseTo(2);
    expect(c.chatUsd).toBe(0);
  });
  it("análisis sin precio propio usa el principal", () => {
    const q = precio({ analysisInputUsdPerMtok: null, analysisOutputUsdPerMtok: null });
    const c = capacityCost({ aiTurns: null, aiTokens: 1_000_000, assistantTokens: 1_000_000, embedTokens: 0 }, q, 1);
    expect(c.assistantUsd).toBeCloseTo(3);
  });
});
