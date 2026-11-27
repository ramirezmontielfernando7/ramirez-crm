import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { changePlanCatalog, clearPlanCatalogCache, getPlanCatalog } from "@/server/plan-catalog/store";

/** 0073 — El catálogo de planes contra Postgres real (tabla de plataforma, pool de sistema). */
describe("catálogo de planes", () => {
  afterEach(() => clearPlanCatalogCache());
  afterAll(async () => {
    await getSystemDb().delete(schema.platformPlanCatalog);
    clearPlanCatalogCache();
  });

  it("sin filas: los valores de fábrica", async () => {
    await getSystemDb().delete(schema.platformPlanCatalog);
    clearPlanCatalogCache();
    const c = await getPlanCatalog();
    expect(c.pro.priceMonthlyMxn).toBe(1999);
  });

  it("cambia un precio, deja el resto y vuelve a fábrica con null", async () => {
    await changePlanCatalog("pro", { priceMonthlyMxn: 1099, features: ["Todo Esencial", "  ", "Agentes"] }, null, null);
    let c = await getPlanCatalog();
    expect(c.pro.priceMonthlyMxn).toBe(1099);
    expect(c.pro.features).toEqual(["Todo Esencial", "Agentes"]);
    expect(c.ultra.priceMonthlyMxn).toBe(2999);
    await changePlanCatalog("pro", { priceMonthlyMxn: null, features: null }, null, null);
    c = await getPlanCatalog();
    expect(c.pro.priceMonthlyMxn).toBe(1999);
    expect(c.pro.features[0]).toBe("Todo Esencial");
  });

  it("marcar un plan como recomendado quita la marca de los otros", async () => {
    await changePlanCatalog("ultra", { recommended: true }, null, null);
    const c = await getPlanCatalog();
    expect([c.pro.recommended, c.ultra.recommended]).toEqual([false, true]);
  });

  it("el CHECK rechaza precios fuera de rango", async () => {
    await expect(changePlanCatalog("pro", { priceMonthlyMxn: -5 }, null, null)).rejects.toThrow();
  });
});
