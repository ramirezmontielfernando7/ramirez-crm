import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * H7 — El token secreto del webhook (y la URL que lo lleva) es de la
 * PLATAFORMA: solo la organización PLATFORM_ORG_ID lo recibe. Sin la
 * variable no lo recibe nadie, jamás "la primera organización".
 */
const TOKEN = "tok_secreto_de_plataforma_123";
const sesion = vi.hoisted(() => ({ organizationId: "org_a", role: "owner" }));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireSession: async () =>
      actual.sessionContext("usr_1", sesion.organizationId, sesion.role),
  };
});

import { GET } from "@/app/api/settings/webhook/route";

async function pedir(): Promise<{ status: number; text: string; json: Record<string, unknown> }> {
  const res = await GET();
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as Record<string, unknown> };
}

describe("GET /api/settings/webhook por organización", () => {
  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "https://crm.ejemplo.test");
    vi.stubEnv("DATABASE_URL", "postgresql://x:y@localhost:5432/z");
    vi.stubEnv("BETTER_AUTH_SECRET", "secreto-de-sesiones-de-prueba");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", TOKEN);
    vi.stubEnv("META_APP_SECRET", "secreto-app");
    sesion.organizationId = "org_a";
    sesion.role = "owner";
  });
  afterEach(() => vi.unstubAllEnvs());

  it("la organización de la plataforma recibe la URL y el token", async () => {
    vi.stubEnv("PLATFORM_ORG_ID", "org_a");
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(r.json.managedByPlatform).toBe(false);
    expect(r.json.verifyToken).toBe(TOKEN);
    expect(String(r.json.url)).toContain(TOKEN);
  });

  it("otra organización NO recibe el token ni la URL: lo administra la plataforma", async () => {
    vi.stubEnv("PLATFORM_ORG_ID", "org_plataforma");
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(r.text).not.toContain(TOKEN);
    expect(r.json).toEqual({ managedByPlatform: true, platformConfigMissing: false, signatureLayer: true });
  });

  it("sin PLATFORM_ORG_ID nadie recibe el token y se avisa que falta", async () => {
    vi.stubEnv("PLATFORM_ORG_ID", "");
    const r = await pedir();
    expect(r.text).not.toContain(TOKEN);
    expect(r.json.platformConfigMissing).toBe(true);
  });

  it("un Asesor de la plataforma sigue sin permiso (403, sin token)", async () => {
    vi.stubEnv("PLATFORM_ORG_ID", "org_a");
    sesion.role = "asesor";
    const r = await pedir();
    expect(r.status).toBe(403);
    expect(r.text).not.toContain(TOKEN);
  });
});
