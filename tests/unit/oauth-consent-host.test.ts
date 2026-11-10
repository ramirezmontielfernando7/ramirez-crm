import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { advancedConsent, DEFAULT_CONNECTOR_SETTINGS, redirectHost, type ConnectorSettings } from "@/lib/ai-connector";

/**
 * Auditoría de seguridad (2026-11) — La pantalla «X quiere actuar como tú»
 * enseña el sitio a donde de verdad viaja el código: el de la `redirect_uri`
 * de ESA solicitud. Antes enseñaba el de la PRIMERA dirección registrada por
 * la app: cualquiera podía registrar una app «Claude» con
 * [`https://claude.ai/…`, `https://sitio-malo.example/…`], pedir el regreso
 * a la segunda y la pantalla decía «La app de claude.ai». Quien aceptaba le
 * entregaba su cuenta al sitio malo.
 */
describe("pantalla de aceptar: el sitio que se enseña", () => {
  it("es el de la dirección de regreso de la solicitud", () => {
    expect(redirectHost("https://sitio-malo.example/callback?x=1")).toBe("sitio-malo.example");
    expect(redirectHost("https://claude.ai/api/mcp/auth_callback")).toBe("claude.ai");
    expect(redirectHost("http://localhost:33418/callback")).toBe("localhost");
  });

  it("una dirección ilegible no enseña ningún sitio", () => {
    expect(redirectHost("no es una url")).toBe("");
  });

  it("la página usa la dirección de la solicitud, no la lista registrada", () => {
    const page = readFileSync(
      path.resolve(import.meta.dirname, "..", "..", "src", "app", "(auth)", "oauth", "authorize", "page.tsx"),
      "utf8"
    );
    expect(page).toContain("clientHost={redirectHost(parsed.data.redirect_uri)}");
    expect(page).not.toMatch(/clientHost=\{[^}]*redirectUris/);
  });
});

/**
 * Auditoría 2026-11 (S-06) — La pantalla no promete «no puede exportar
 * contactos ni mandar campañas» cuando el Propietario sí lo encendió.
 */
describe("pantalla de aceptar: funciones avanzadas", () => {
  const on: ConnectorSettings = {
    ...DEFAULT_CONNECTOR_SETTINGS,
    enabled: true,
    advanced: { enabled: true, roles: ["coordinador"], areas: ["contacts", "campaigns"], launchCampaigns: true },
  };

  it("apagadas (lo de fábrica): nada que avisar", () => {
    expect(advancedConsent("owner", DEFAULT_CONNECTOR_SETTINGS)).toEqual({ labels: [], launch: false });
    expect(advancedConsent("owner", { ...on, advanced: { ...on.advanced, enabled: false } }).labels).toEqual([]);
  });

  it("encendidas: se dicen las áreas abiertas y si puede lanzar campañas", () => {
    expect(advancedConsent("owner", on)).toEqual({
      labels: ["Exportar e importar contactos", "Preparar campañas"],
      launch: true,
    });
    expect(advancedConsent("coordinador", on).labels).toHaveLength(2);
    expect(advancedConsent("owner", { ...on, advanced: { ...on.advanced, launchCampaigns: false } }).launch).toBe(false);
  });

  it("el Asesor nunca las tiene; el Coordinador solo si se le dieron", () => {
    expect(advancedConsent("asesor", on)).toEqual({ labels: [], launch: false });
    expect(advancedConsent("coordinador", { ...on, advanced: { ...on.advanced, roles: [] } }).labels).toEqual([]);
  });

  it("sin el área de campañas no hay «lanzar», aunque el interruptor esté encendido", () => {
    expect(advancedConsent("owner", { ...on, advanced: { ...on.advanced, areas: ["contacts"] } }).launch).toBe(false);
  });
});
