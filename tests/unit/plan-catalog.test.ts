import { describe, expect, it } from "vitest";
import { cleanFeatures, DEFAULT_PLAN_CATALOG, formatMxn, freeMonths, mergeCatalog, yearlyPrice } from "@/lib/plan-catalog";

describe("catálogo de planes", () => {
  it("de fábrica: 499 / 899 / 1,799, Pro recomendado y sin Messenger, Facebook ni Instagram", () => {
    const c = mergeCatalog({});
    expect([c.esencial.priceMonthlyMxn, c.pro.priceMonthlyMxn, c.ultra.priceMonthlyMxn]).toEqual([499, 899, 1799]);
    expect(c.pro.recommended).toBe(true);
    const texto = JSON.stringify(DEFAULT_PLAN_CATALOG).toLowerCase();
    for (const prohibido of ["messenger", "facebook", "instagram"]) expect(texto).not.toContain(prohibido);
  });

  it("lo guardado se monta encima y lo que falta queda de fábrica", () => {
    const c = mergeCatalog({ pro: { priceMonthlyMxn: 999, name: "Pro Plus" } });
    expect(c.pro).toMatchObject({ name: "Pro Plus", priceMonthlyMxn: 999, peopleLimit: 5 });
    expect(c.esencial.priceMonthlyMxn).toBe(499);
  });

  it("anual: 10 mensualidades por defecto («2 meses gratis») o el precio que se escriba", () => {
    expect(yearlyPrice({ priceMonthlyMxn: 899, priceYearlyMxn: null })).toBe(8990);
    expect(freeMonths({ priceMonthlyMxn: 899, priceYearlyMxn: null })).toBe(2);
    expect(yearlyPrice({ priceMonthlyMxn: 899, priceYearlyMxn: 9000 })).toBe(9000);
    expect(freeMonths({ priceMonthlyMxn: 0, priceYearlyMxn: null })).toBe(0);
  });

  it("solo un plan recomendado (queda el primero)", () => {
    const c = mergeCatalog({ esencial: { recommended: true }, pro: { recommended: true } });
    expect([c.esencial.recommended, c.pro.recommended, c.ultra.recommended]).toEqual([true, false, false]);
  });

  it("viñetas: sin vacías ni repetidas y con tope", () => {
    expect(cleanFeatures(["  A  ", "", "a", "B"])).toEqual(["A", "B"]);
    expect(cleanFeatures(Array.from({ length: 20 }, (_, i) => `x${i}`))).toHaveLength(8);
  });

  it("formatea pesos", () => {
    expect(formatMxn(1799)).toBe("$1,799");
  });
});
