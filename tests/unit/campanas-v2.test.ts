import { describe, expect, it } from "vitest";
import { resolveVariables } from "@/lib/campaigns";
import { safetyCheck, USAGE_RETRY_MS } from "@/server/campaigns/safety";
import { cleanRates, DEFAULT_CAMPAIGN_SETTINGS, estimateCost } from "@/server/campaigns/settings";
import { MAX_ATTEMPTS, RETRY_BACKOFF_MS } from "@/server/campaigns/outcome";

const settings = DEFAULT_CAMPAIGN_SETTINGS;
const ok = { quality: "GREEN", accountEvent: null, usage: 0, limit: 1000 };
const outcomes = (failed: number, total: number) =>
  Array.from({ length: total }, (_, i) => ({ failed: i < failed }));

describe("Campañas v2 — pausa de seguridad", () => {
  it("tasa de fallos: solo con la ventana completa y al llegar al tope", () => {
    expect(safetyCheck({ settings, recent: outcomes(49, 49), ...ok })).toBeNull(); // ventana incompleta
    expect(safetyCheck({ settings, recent: outcomes(9, 50), ...ok })).toBeNull(); // 18 %
    const p = safetyCheck({ settings, recent: outcomes(10, 50), ...ok }); // 20 %
    expect(p?.reason).toMatch(/fallaron 10 de los últimos 50/);
    expect(p?.resumeAt).toBeNull();
  });

  it("calidad ROJA pausa (configurable); AMARILLA no", () => {
    expect(safetyCheck({ settings, recent: [], ...ok, quality: "YELLOW" })).toBeNull();
    expect(safetyCheck({ settings, recent: [], ...ok, quality: "RED" })?.reason).toMatch(/roja/);
    expect(safetyCheck({ settings: { ...settings, pauseOnQualityRed: false }, recent: [], ...ok, quality: "RED" })).toBeNull();
  });

  it("aviso de restricción de la cuenta pausa", () => {
    expect(
      safetyCheck({ settings, recent: [], ...ok, accountEvent: { event: "ACCOUNT_RESTRICTION" } })?.reason
    ).toMatch(/restricción/);
    expect(safetyCheck({ settings, recent: [], ...ok, accountEvent: { event: "ACCOUNT_UPDATE" } })).toBeNull();
  });

  it("uso del límite leído de Meta: pausa al tope y se reintenta sola", () => {
    const now = new Date("2026-10-02T10:00:00Z");
    expect(safetyCheck({ settings, recent: [], ...ok, usage: 949, now })).toBeNull();
    const p = safetyCheck({ settings, recent: [], ...ok, usage: 950, now });
    expect(p?.resumeAt?.getTime()).toBe(now.getTime() + USAGE_RETRY_MS);
    // Sin límite conocido (ilimitado o sin lectura) no se inventa uno.
    expect(safetyCheck({ settings, recent: [], ...ok, usage: 1e9, limit: null })).toBeNull();
  });
});

describe("Campañas v2 — costo ESTIMADO (tarifas del negocio, nunca de Meta)", () => {
  it("sin tarifa capturada no hay estimado", () => {
    expect(estimateCost({ rates: {}, currency: null }, "MARKETING", 100)).toBeNull();
  });
  it("destinatarios × tarifa de la categoría de la plantilla", () => {
    expect(estimateCost({ rates: { marketing: 0.0436 }, currency: "USD" }, "MARKETING", 1000)).toEqual({ amount: 43.6, currency: "USD" });
  });
  it("las tarifas solo aceptan categorías conocidas y números ≥ 0", () => {
    expect(cleanRates({ marketing: 1, utility: -1, otra: 2, authentication: "x" })).toEqual({ marketing: 1 });
  });
});

describe("Campañas v2 — variables desde columnas", () => {
  it("columna de la base; vacía queda vacía (el lanzamiento la excluye)", () => {
    expect(
      resolveVariables([{ kind: "contact_name" }, { kind: "column", column: "cupón" }], "ana lópez", { cupón: " A10 " })
    ).toEqual(["Ana", "A10"]);
    expect(resolveVariables([{ kind: "column", column: "cupón" }], "Ana", {})).toEqual([""]);
  });
});

describe("Campañas v2 — reintentos con espera creciente y tope", () => {
  it("espera crece y el tope es finito", () => {
    // (en pruebas CAMPAIGN_BACKOFF_SCALE acorta el reloj; aquí se mira la tabla)
    for (let i = 1; i < RETRY_BACKOFF_MS.length; i++) expect(RETRY_BACKOFF_MS[i - 1]).toBeLessThan(RETRY_BACKOFF_MS[i]!);
    expect(MAX_ATTEMPTS).toBe(RETRY_BACKOFF_MS.length);
  });
});
