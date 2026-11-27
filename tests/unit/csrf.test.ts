import { describe, expect, it } from "vitest";
import { isCrossSiteWrite, type CsrfInput } from "@/lib/security/csrf";

const COOKIE = "__Secure-better-auth.session_token=abc.def; otra=1";

function req(over: Partial<CsrfInput> = {}): CsrfInput {
  return {
    method: "POST",
    pathname: "/api/contacts",
    cookie: COOKIE,
    origin: "https://dash.example.com",
    secFetchSite: "same-origin",
    host: "dash.example.com",
    ...over,
  };
}

describe("freno CSRF de la API (auditoría 2026-11)", () => {
  it("deja pasar lo que hace la propia app", () => {
    expect(isCrossSiteWrite(req())).toBe(false);
    for (const method of ["PUT", "PATCH", "DELETE"]) expect(isCrossSiteWrite(req({ method }))).toBe(false);
  });

  it("rechaza una escritura con sesión que viene de un SUBDOMINIO hermano (same-site)", () => {
    expect(isCrossSiteWrite(req({ secFetchSite: "same-site", origin: "https://crm.example.com" }))).toBe(true);
  });

  it("rechaza una escritura con sesión que viene de otro sitio", () => {
    expect(isCrossSiteWrite(req({ secFetchSite: "cross-site", origin: "https://malo.example.org" }))).toBe(true);
  });

  it("las lecturas nunca se frenan (GET/HEAD/OPTIONS)", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(isCrossSiteWrite(req({ method, secFetchSite: "cross-site" }))).toBe(false);
    }
  });

  it("sin cookie de sesión no hay nada que falsificar", () => {
    expect(isCrossSiteWrite(req({ cookie: null, secFetchSite: "cross-site" }))).toBe(false);
    expect(isCrossSiteWrite(req({ cookie: "otra=1", secFetchSite: "cross-site" }))).toBe(false);
  });

  it("reconoce la cookie con y sin prefijo __Secure-", () => {
    expect(isCrossSiteWrite(req({ cookie: "better-auth.session_token=x", secFetchSite: "cross-site" }))).toBe(true);
    expect(isCrossSiteWrite(req({ cookie: "a=1; __Secure-better-auth.session_token=x", secFetchSite: "cross-site" }))).toBe(true);
  });

  it("las rutas que se autentican sin cookie quedan fuera", () => {
    for (const pathname of [
      "/api/auth/sign-in/email",
      "/api/webhooks/wa/tok",
      "/api/webhooks/direct/abc",
      "/api/bot/messages",
      "/api/mcp",
      "/api/oauth/token",
      "/api/account-link/tok",
      "/api/ai-connector/upload-links/tok/files",
      "/api/csp-report",
      "/api/dev/wa-mock/inbound",
    ]) {
      expect(isCrossSiteWrite(req({ pathname, secFetchSite: "cross-site" }))).toBe(false);
    }
  });

  it("fuera de /api no actúa", () => {
    expect(isCrossSiteWrite(req({ pathname: "/inbox", secFetchSite: "cross-site" }))).toBe(false);
  });

  it("navegador sin Sec-Fetch-Site: decide el Origin contra el host", () => {
    expect(isCrossSiteWrite(req({ secFetchSite: null }))).toBe(false);
    expect(isCrossSiteWrite(req({ secFetchSite: null, origin: "https://crm.example.com" }))).toBe(true);
    expect(isCrossSiteWrite(req({ secFetchSite: null, origin: "https://dash.example.com", host: "DASH.example.com" }))).toBe(false);
    expect(isCrossSiteWrite(req({ secFetchSite: null, origin: "no-es-url" }))).toBe(true);
  });

  it("Origin: null con cookie se rechaza", () => {
    expect(isCrossSiteWrite(req({ secFetchSite: null, origin: "null" }))).toBe(true);
  });

  it("sin Sec-Fetch-Site ni Origin (no es un navegador) pasa", () => {
    expect(isCrossSiteWrite(req({ secFetchSite: null, origin: null }))).toBe(false);
  });

  it("Sec-Fetch-Site: none (URL escrita a mano) pasa", () => {
    expect(isCrossSiteWrite(req({ secFetchSite: "none", origin: null }))).toBe(false);
  });
});
