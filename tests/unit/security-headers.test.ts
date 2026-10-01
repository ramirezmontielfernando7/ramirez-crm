import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENFORCED_CSP, OWN_CSP_PATHS, OWN_CSP_SOURCE, securityHeaders } from "@/lib/security/headers";

// El patrón de next.config (`/:path(<regex>)`) como RegExp.
const inner = OWN_CSP_SOURCE.slice("/:path(".length, -1);
const aplicaCsp = (p: string) => new RegExp(`^/${inner}$`).test(p);

function rutas(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const full = path.join(dir, f);
    return statSync(full).isDirectory() ? rutas(full) : f === "route.ts" ? [full] : [];
  });
}

describe("cabeceras de seguridad (H10)", () => {
  it("HSTS empieza en un día y la CSP completa solo reporta", () => {
    const h = Object.fromEntries(securityHeaders(false).map((x) => [x.key, x.value]));
    expect(h["Strict-Transport-Security"]).toBe("max-age=86400");
    expect(h["Content-Security-Policy-Report-Only"]).toContain("report-uri /api/csp-report");
    expect(h["Content-Security-Policy"]).toBeUndefined();
    expect(ENFORCED_CSP.value).toBe("frame-ancestors 'none'");
  });

  it("frame-ancestors se aplica a páginas y API, no a las rutas con CSP propia", () => {
    for (const p of ["/", "/inbox", "/platform", "/api/conversations", "/activar/abc"]) {
      expect(aplicaCsp(p), p).toBe(true);
    }
    for (const p of [
      "/api/media/ma_1",
      "/api/team-chat/attachments/tca_1",
      "/api/knowledge/kn_1/file",
      "/api/branding/favicon",
    ]) {
      expect(aplicaCsp(p), p).toBe(false);
    }
  });

  it("toda ruta que fija su propia CSP está excluida", () => {
    const api = path.join(process.cwd(), "src/app/api");
    const propias = rutas(api).filter((f) =>
      /content-security-policy|attachmentHeaders|attachment-headers/i.test(readFileSync(f, "utf8")),
    );
    expect(propias.length).toBeGreaterThan(0);
    for (const f of propias) {
      const url = "/" + path.relative(path.join(process.cwd(), "src/app"), path.dirname(f)).replace(/\[[^\]]+\]/g, "x");
      expect(aplicaCsp(url), `${url} fija su CSP: súmala a OWN_CSP_PATHS (${OWN_CSP_PATHS.length})`).toBe(false);
    }
  });
});
