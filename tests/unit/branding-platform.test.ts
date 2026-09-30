import { describe, expect, it, vi } from "vitest";
import { PLATFORM_BRANDING } from "@/lib/branding";

/**
 * H11 — Sin sesión (login, pestaña, favicon público) la marca es la de la
 * PLATAFORMA. Antes era la de "la primera organización": el nombre y el logo
 * de un cliente, para cualquiera que abriera el login.
 */
const consultas = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit"]) {
    builder[m] = () => {
      consultas.n++;
      return builder;
    };
  }
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve([{ id: "org_cliente", metadata: JSON.stringify({ branding: { name: "Cliente Secreto", accent: "#aa3355" } }) }]);
  return { ...actual, getDb: () => builder };
});

import { getBranding, getBrandingContext } from "@/server/branding";

describe("marca sin sesión", () => {
  it("sin organización: la de la plataforma, sin tocar la BD", async () => {
    consultas.n = 0;
    expect(await getBrandingContext()).toEqual({ organizationId: null, branding: PLATFORM_BRANDING });
    expect(await getBrandingContext(null)).toEqual({ organizationId: null, branding: PLATFORM_BRANDING });
    expect(await getBranding(undefined)).toEqual(PLATFORM_BRANDING);
    expect(consultas.n).toBe(0);
  });

  it("con organización: la de ESA organización", async () => {
    const ctx = await getBrandingContext("org_cliente");
    expect(ctx.organizationId).toBe("org_cliente");
    expect(ctx.branding.name).toBe("Cliente Secreto");
  });

  it("la marca de plataforma no es la de ningún cliente (constante única)", () => {
    expect(PLATFORM_BRANDING.name).toBe("Dashfort");
  });
});
