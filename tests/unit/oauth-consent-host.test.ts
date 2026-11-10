import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { redirectHost } from "@/lib/ai-connector";

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
