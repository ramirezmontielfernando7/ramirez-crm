import { describe, expect, it } from "vitest";
import {
  chunkRange,
  isAnalyticsNotEnabled,
  parsePricingAnalytics,
  parseTemplateAnalytics,
  pricingAnalyticsFields,
  syncWindow,
  templateAnalyticsFields,
} from "@/lib/meta-analytics";
import { campaignEstimatedCost, emptyFunnel, metricsCsv, pct, reconcileCost } from "@/lib/campaign-metrics";

const DAY = 86_400;
const NOW = new Date("2026-10-02T15:00:00Z");
const TODAY = Date.parse("2026-10-02T00:00:00Z") / 1000;

describe("ventana de sincronización", () => {
  it("primera vez: 90 días de plantillas y 1 año de precios, hasta hoy incluido", () => {
    expect(syncWindow("template", null, NOW)).toEqual({ start: TODAY - 89 * DAY, end: TODAY + DAY });
    expect(syncWindow("pricing", null, NOW)).toEqual({ start: TODAY - 364 * DAY, end: TODAY + DAY });
  });
  it("después: 3 días antes de la última, sin salirse de la retención", () => {
    expect(syncWindow("pricing", new Date("2026-10-01T10:00:00Z"), NOW).start).toBe(TODAY - 4 * DAY);
    expect(syncWindow("template", new Date("2025-01-01T00:00:00Z"), NOW).start).toBe(TODAY - 89 * DAY);
  });
  it("tramos sin huecos ni traslapes", () => {
    const parts = chunkRange(0, 95 * DAY, 30);
    expect(parts).toHaveLength(4);
    expect(parts[3]).toEqual({ start: 90 * DAY, end: 95 * DAY });
  });
  it("los campos no dejan pasar ids raros", () => {
    expect(templateAnalyticsFields(1, 2, ["123", "x)(y"])).toContain('template_ids(["123"])');
    expect(pricingAnalyticsFields(1, 2)).toMatch(/^currency,pricing_analytics\.start\(1\)\.end\(2\)/);
  });
});

describe("lectura de las respuestas de Meta", () => {
  it("plantillas: días UTC, clics sumados, basura ignorada", () => {
    const rows = parseTemplateAnalytics({
      template_analytics: {
        data: [
          {
            data_points: [
              { template_id: "1", start: TODAY, sent: 5, delivered: "4", read: 2, clicked: [{ count: 1 }, { count: 2 }] },
              { template_id: "", start: TODAY },
              null,
            ],
          },
        ],
      },
    });
    expect(rows).toEqual([
      { waTemplateId: "1", day: "2026-10-02", sent: 5, delivered: 4, read: 2, clicked: 3, clicks: expect.any(Array) },
    ]);
    expect(parseTemplateAnalytics({ algo: "inesperado" })).toEqual([]);
  });
  it("precios: suma lo repetido y lee la moneda", () => {
    const r = parsePricingAnalytics({
      currency: "mxn",
      pricing_analytics: {
        data: [
          {
            data_points: [
              { start: TODAY, pricing_category: "marketing", pricing_type: "REGULAR", country: "MX", volume: 2, cost: 1.25 },
              { start: TODAY, pricing_category: "MARKETING", pricing_type: "REGULAR", country: "MX", volume: 3, cost: "0.75" },
            ],
          },
        ],
      },
    });
    expect(r.currency).toBe("MXN");
    expect(r.rows).toEqual([
      { day: "2026-10-02", phoneNumberId: "", country: "MX", pricingCategory: "MARKETING", pricingType: "REGULAR", volume: 5, cost: 2 },
    ]);
  });
  it("reconoce «analíticas no activas» sin confundirlo con otro error", () => {
    expect(isAnalyticsNotEnabled("Template analytics is not enabled for this WABA")).toBe(true);
    expect(isAnalyticsNotEnabled("(#100) Param is_enabled_for_insights must be true")).toBe(true);
    expect(isAnalyticsNotEnabled("(#4) Application request limit reached")).toBe(false);
    expect(isAnalyticsNotEnabled(null)).toBe(false);
  });
});

describe("costo y conciliación", () => {
  it("estimado por campaña: prorrateo de lo lanzado, o tarifa de hoy, o nada", () => {
    expect(campaignEstimatedCost({ launchEstimate: 10, total: 10, sent: 4, rate: 9 })).toBe(4);
    expect(campaignEstimatedCost({ launchEstimate: null, total: 10, sent: 4, rate: 0.5 })).toBe(2);
    expect(campaignEstimatedCost({ launchEstimate: null, total: 10, sent: 4, rate: undefined })).toBeNull();
  });
  it("la diferencia solo se calcula con ambos datos y la misma moneda", () => {
    const base = { byCategory: [], estimatedCurrency: "MXN", reportedCurrency: "MXN" };
    expect(reconcileCost({ ...base, estimated: 4, reported: 7.5 }).difference).toBe(3.5);
    expect(reconcileCost({ ...base, estimated: null, reported: 7.5 }).differenceNote).toMatch(/tarifas/);
    expect(reconcileCost({ ...base, estimated: 4, reported: null }).differenceNote).toMatch(/Meta aún no/);
    const otra = reconcileCost({ ...base, reportedCurrency: "USD", estimated: 4, reported: 7.5 });
    expect(otra.difference).toBeNull();
    expect(otra.differenceNote).toMatch(/Monedas distintas/);
  });
  it("porcentajes sin dividir entre cero", () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(1, 0)).toBeNull();
  });
  it("CSV con una fila por campaña y el total, protegido contra fórmulas", () => {
    const csv = metricsCsv({
      campaigns: [
        { id: "c1", name: "=HYPERLINK()", status: "completed", startedAt: "2026-10-01T00:00:00Z", templateName: "t", category: "marketing", phoneNumberId: null, ...emptyFunnel(), sent: 2, delivered: 1, estimatedCost: 1 },
      ],
      totals: { ...emptyFunnel(), sent: 2, delivered: 1 },
      cost: reconcileCost({ estimated: 1, estimatedCurrency: null, reported: null, reportedCurrency: null, byCategory: [] }),
    });
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^'=HYPERLINK\(\),2026-10-01,t,marketing,2,1,50,/);
    expect(lines[2]).toMatch(/^Total del periodo/);
  });
});
