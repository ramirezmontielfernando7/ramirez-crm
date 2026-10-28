import { describe, expect, it } from "vitest";
import {
  advancedAllows,
  bearerToken,
  DEFAULT_ADVANCED_SETTINGS,
  negotiateProtocolVersion,
  normalizeScopes,
  parseRpc,
  protectedResourceMetadata,
  resourceMetadataUrl,
  roleMayConnect,
} from "@/lib/ai-connector";

/** 047 — Reglas puras del conector de IA. */
describe("conector de IA — reglas puras", () => {
  it("solo acepta llaves de acceso o personales con el formato de Dashfort", () => {
    const key = "dfk_" + "a".repeat(43);
    expect(bearerToken(`Bearer ${key}`)).toBe(key);
    expect(bearerToken(`bearer   ${key}`)).toBe(key);
    expect(bearerToken("Bearer dfr_" + "a".repeat(43))).toBeNull();
    expect(bearerToken("Bearer dfk_corta")).toBeNull();
    expect(bearerToken(key)).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it("los alcances siempre incluyen leer y descartan lo desconocido", () => {
    expect(normalizeScopes([])).toEqual(["read"]);
    expect(normalizeScopes(["write", "admin", "write"])).toEqual(["read", "write"]);
  });

  it("decisión 1: el Propietario siempre puede; los demás si él encendió su rol", () => {
    const on = { enabled: true, allowedRoles: ["asesor"], dailyMessageLimit: 100, advanced: DEFAULT_ADVANCED_SETTINGS };
    expect(roleMayConnect("owner", on)).toBe(true);
    expect(roleMayConnect("asesor", on)).toBe(true);
    expect(roleMayConnect("coordinador", on)).toBe(false);
    expect(roleMayConnect("owner", { ...on, enabled: false })).toBe(false);
  });

  it("PR 6: funciones avanzadas = Propietario siempre, Coordinador si se le dio, Asesor nunca", () => {
    const base = { enabled: true, allowedRoles: ["coordinador", "asesor"], dailyMessageLimit: 100 };
    const off = { ...base, advanced: DEFAULT_ADVANCED_SETTINGS };
    expect(advancedAllows("owner", off, "tags")).toBe(false);
    const on = { ...base, advanced: { enabled: true, roles: [], areas: ["tags" as const], launchCampaigns: false } };
    expect(advancedAllows("owner", on, "tags")).toBe(true);
    expect(advancedAllows("owner", on, "contacts")).toBe(false);
    expect(advancedAllows("coordinador", on, "tags")).toBe(false);
    const coord = { ...on, advanced: { ...on.advanced, roles: ["coordinador", "asesor"] } };
    expect(advancedAllows("coordinador", coord, "tags")).toBe(true);
    expect(advancedAllows("asesor", coord, "tags")).toBe(false);
    expect(advancedAllows("owner", { ...on, enabled: false }, "tags")).toBe(false);
  });

  it("negocia la versión de MCP del cliente o responde con la más nueva", () => {
    expect(negotiateProtocolVersion("2025-06-18")).toBe("2025-06-18");
    expect(negotiateProtocolVersion("2024-01-01")).toBe("2026-07-28");
    expect(negotiateProtocolVersion(undefined)).toBe("2026-07-28");
  });

  it("parseRpc rechaza lo que no es JSON-RPC 2.0", () => {
    expect(parseRpc({ jsonrpc: "2.0", id: 1, method: "ping" })).not.toBeNull();
    expect(parseRpc({ jsonrpc: "2.0", method: "notifications/initialized" })).not.toBeNull();
    expect(parseRpc({ jsonrpc: "1.0", id: 1, method: "ping" })).toBeNull();
    expect(parseRpc({ jsonrpc: "2.0", id: {}, method: "ping" })).toBeNull();
    expect(parseRpc({ jsonrpc: "2.0", id: 1, method: "x", params: [1] })).toBeNull();
    expect(parseRpc([])).toBeNull();
  });

  it("metadatos RFC 9728 apuntan al conector y al mismo dominio para iniciar sesión", () => {
    expect(protectedResourceMetadata("https://crm.ejemplo.mx/")).toMatchObject({
      resource: "https://crm.ejemplo.mx/api/mcp",
      authorization_servers: ["https://crm.ejemplo.mx"],
    });
    expect(resourceMetadataUrl("https://crm.ejemplo.mx")).toBe(
      "https://crm.ejemplo.mx/.well-known/oauth-protected-resource/api/mcp"
    );
  });
});
