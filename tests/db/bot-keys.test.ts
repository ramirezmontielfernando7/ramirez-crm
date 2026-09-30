import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
// PR 3: la prueba prepara y revisa como PLATAFORMA (pool de sistema); lo que
// prueba (ingesta, llaves, membresía) elige su pool por su cuenta.
import { eq } from "drizzle-orm";
import { getSystemDb as getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { requireBotKey } from "@/server/bot/auth";
import { botKeyPrefix, generateBotKey, hashBotKey, resolveBotKey, syncEnvBotKey } from "@/server/bot/keys";
import { resetRateLimit } from "@/lib/rate-limit";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * H2 — Llaves del cerebro externo contra Postgres real: cada llave abre SU
 * organización y ninguna otra; la BOT_API_KEY de la variable solo se liga a
 * PLATFORM_ORG_ID, jamás a "la primera organización".
 */
describe("llaves del cerebro externo", () => {
  let A: { id: string };
  let B: { id: string };

  async function crearLlave(organizationId: string): Promise<string> {
    const key = generateBotKey();
    await getDb().insert(schema.botApiKey).values({
      id: newId("botApiKey"),
      organizationId,
      name: "prueba",
      keyPrefix: botKeyPrefix(key),
      keyHash: hashBotKey(key),
    });
    return key;
  }
  const req = (key: string) => new Request("http://x/api/bot/context", { headers: { "x-api-key": key } });

  beforeAll(async () => {
    A = await crearOrganizacion("Llaves A");
    B = await crearOrganizacion("Llaves B");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimit();
  });
  afterAll(async () => {
    await getDb().delete(schema.botApiKey).where(eq(schema.botApiKey.source, "env"));
    await borrarOrganizaciones([A.id, B.id]);
  });

  it("la llave de A resuelve a A y la de B a B", async () => {
    const ka = await crearLlave(A.id);
    const kb = await crearLlave(B.id);
    expect(await requireBotKey(req(ka))).toEqual({ ok: true, organizationId: A.id });
    expect(await requireBotKey(req(kb))).toEqual({ ok: true, organizationId: B.id });
  });

  it("solo se guarda el hash: la llave en claro no está en la base", async () => {
    const ka = await crearLlave(A.id);
    const filas = await getDb().select().from(schema.botApiKey).where(eq(schema.botApiKey.organizationId, A.id));
    expect(JSON.stringify(filas)).not.toContain(ka);
  });

  it("una llave revocada responde 401", async () => {
    const ka = await crearLlave(A.id);
    await getDb().update(schema.botApiKey).set({ revokedAt: new Date() }).where(eq(schema.botApiKey.keyHash, hashBotKey(ka)));
    expect(await resolveBotKey(ka)).toBeNull();
    const r = await requireBotKey(req(ka));
    expect(r.ok ? 200 : r.response.status).toBe(401);
  });

  it("BOT_API_KEY sin PLATFORM_ORG_ID no abre nada (ni la primera organización)", async () => {
    const env = "clave-de-entorno-" + generateBotKey();
    vi.stubEnv("BOT_API_KEY", env);
    vi.stubEnv("PLATFORM_ORG_ID", "");
    await syncEnvBotKey();
    expect(await resolveBotKey(env)).toBeNull();
  });

  it("BOT_API_KEY con PLATFORM_ORG_ID abre SOLO esa organización; idempotente", async () => {
    const env = "clave-de-entorno-" + generateBotKey();
    vi.stubEnv("BOT_API_KEY", env);
    vi.stubEnv("PLATFORM_ORG_ID", B.id);
    await syncEnvBotKey();
    await syncEnvBotKey();
    expect(await resolveBotKey(env)).toMatchObject({ organizationId: B.id });
    const envRows = await getDb().select().from(schema.botApiKey).where(eq(schema.botApiKey.keyHash, hashBotKey(env)));
    expect(envRows).toHaveLength(1);
  });

  it("si la variable cambia, la llave anterior deja de valer", async () => {
    const vieja = "clave-vieja-" + generateBotKey();
    const nueva = "clave-nueva-" + generateBotKey();
    vi.stubEnv("PLATFORM_ORG_ID", A.id);
    vi.stubEnv("BOT_API_KEY", vieja);
    await syncEnvBotKey();
    vi.stubEnv("BOT_API_KEY", nueva);
    await syncEnvBotKey();
    expect(await resolveBotKey(vieja)).toBeNull();
    expect(await resolveBotKey(nueva)).toMatchObject({ organizationId: A.id });
  });

  it("si se quita la variable, ninguna llave de origen env sigue activa", async () => {
    const env = "clave-de-entorno-" + generateBotKey();
    vi.stubEnv("PLATFORM_ORG_ID", A.id);
    vi.stubEnv("BOT_API_KEY", env);
    await syncEnvBotKey();
    vi.stubEnv("BOT_API_KEY", "");
    await syncEnvBotKey();
    expect(await resolveBotKey(env)).toBeNull();
  });
});
