import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * FR-040/FR-080s: el token se guarda cifrado (jamás texto plano en la fila)
 * y a la UI solo viajan los últimos 4 caracteres. Fase 3: con la versión de
 * llave con que se cifró, y la WABA registrada en la MISMA transacción (H8).
 */

const insertedRows: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => {
  const chain = (): Record<string, unknown> =>
    new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === "then" ? undefined : () => chain(),
      }
    );
  const tx = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertedRows.push(v);
        return {
          onConflictDoUpdate: () => Promise.resolve(),
          onConflictDoNothing: () => Promise.resolve(),
        };
      },
    }),
    select: () => chain(),
    delete: () => ({ where: () => Promise.resolve() }),
  };
  return {
    getDb: () => tx,
    withTenant: (_org: string, fn: (db: typeof tx) => Promise<unknown>) => fn(tx),
    schema: {
      metaCredentials: { organizationId: "organization_id", wabaId: "waba_id" },
      whatsappBusinessAccount: { organizationId: "organization_id", wabaId: "waba_id" },
    },
  };
});

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.ENCRYPTION_KEY_VERSION = "3";
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

describe("credenciales de WhatsApp", () => {
  it("saveCredentials registra la WABA y cifra el token con la versión actual", async () => {
    const { saveCredentials } = await import("@/server/whatsapp/credentials");
    const token = "EAAG-token-super-secreto-abcd";
    await saveCredentials({
      organizationId: "org_1",
      wabaId: "1234567",
      phoneNumberId: "7654321",
      token,
    });
    const waba = insertedRows.find((r) => !("tokenCipher" in r))!;
    expect(waba).toMatchObject({ organizationId: "org_1", wabaId: "1234567" });
    const row = insertedRows.find((r) => "tokenCipher" in r)!;
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.keyVersion).toBe(3);

    // y el cifrado es reversible con la llave de esa versión
    const { openSecret } = await import("@/lib/crypto");
    expect(
      openSecret(
        { cipher: row.tokenCipher as string, iv: row.tokenIv as string, tag: row.tokenTag as string },
        row.keyVersion as number
      )
    ).toBe(token);
  });

  it("tokenLast4 expone solo los últimos 4 caracteres", async () => {
    const { tokenLast4 } = await import("@/server/whatsapp/credentials");
    expect(tokenLast4("EAAG-token-super-secreto-abcd")).toBe("abcd");
  });

  it("H8: los IDs de Meta son solo dígitos (sin mocks)", async () => {
    const { isValidWabaId, isValidPhoneNumberId } = await import("@/server/whatsapp/credentials");
    expect(isValidWabaId("102938475610293")).toBe(true);
    expect(isValidWabaId("WABA-E2E")).toBe(false);
    expect(isValidWabaId("12 34")).toBe(false);
    expect(isValidPhoneNumberId("1029384756")).toBe(true);
    expect(isValidPhoneNumberId("1029;drop")).toBe(false);
  });
});
