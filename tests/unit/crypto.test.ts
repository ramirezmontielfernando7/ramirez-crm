import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";

const KEY_A = Buffer.alloc(32, 7).toString("base64");
const KEY_B = Buffer.alloc(32, 8).toString("base64");

function setKeys(env: Record<string, string | undefined>) {
  for (const k of ["ENCRYPTION_KEY", "ENCRYPTION_KEY_VERSION", "ENCRYPTION_KEY_OLD", "ENCRYPTION_KEY_OLD_VERSION"]) {
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  resetEnvCacheForTests();
}

beforeEach(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-token-test";
  setKeys({ ENCRYPTION_KEY: KEY_A });
});

describe("crypto AES-256-GCM", () => {
  it("cifra y descifra (roundtrip) con la versión 1 por defecto", async () => {
    const { sealSecret, openSecret } = await import("@/lib/crypto");
    const value = sealSecret("EAAG-token-super-secreto");
    expect(value.cipher).not.toContain("token");
    expect(value.keyVersion).toBe(1);
    expect(Buffer.from(value.iv, "base64")).toHaveLength(12);
    expect(openSecret(value, 1)).toBe("EAAG-token-super-secreto");
  });

  it("dos cifrados del mismo texto producen ciphertexts distintos (IV aleatorio)", async () => {
    const { sealSecret } = await import("@/lib/crypto");
    const a = sealSecret("mismo-texto");
    const b = sealSecret("mismo-texto");
    expect(a.cipher).not.toBe(b.cipher);
    expect(a.iv).not.toBe(b.iv);
  });

  it("tag manipulado lanza DecryptError (integridad GCM)", async () => {
    const { sealSecret, openSecret, DecryptError } = await import("@/lib/crypto");
    const value = sealSecret("dato");
    const tampered = { ...value, tag: Buffer.alloc(16, 1).toString("base64") };
    expect(() => openSecret(tampered, 1)).toThrow(DecryptError);
  });
});

describe("llave versionada (Fase 3)", () => {
  it("durante la rotación abre lo viejo con ENCRYPTION_KEY_OLD y cifra lo nuevo con la actual", async () => {
    const { sealSecret, openSecret } = await import("@/lib/crypto");
    const viejo = sealSecret("token-viejo"); // versión 1, llave A
    setKeys({ ENCRYPTION_KEY: KEY_B, ENCRYPTION_KEY_VERSION: "2", ENCRYPTION_KEY_OLD: KEY_A, ENCRYPTION_KEY_OLD_VERSION: "1" });
    expect(openSecret(viejo, 1)).toBe("token-viejo");
    const nuevo = sealSecret("token-nuevo");
    expect(nuevo.keyVersion).toBe(2);
    expect(openSecret(nuevo, 2)).toBe("token-nuevo");
  });

  it("sin la llave de esa versión: KeyUnavailableError (no un descifrado basura)", async () => {
    const { sealSecret, openSecret, KeyUnavailableError } = await import("@/lib/crypto");
    const viejo = sealSecret("token-viejo");
    setKeys({ ENCRYPTION_KEY: KEY_B, ENCRYPTION_KEY_VERSION: "2" });
    expect(() => openSecret(viejo, 1)).toThrow(KeyUnavailableError);
  });

  it("la versión correcta con la llave equivocada: DecryptError", async () => {
    const { sealSecret, openSecret, DecryptError } = await import("@/lib/crypto");
    const viejo = sealSecret("token-viejo");
    // Error del operador: pegó otra llave diciendo que es la versión 1.
    setKeys({ ENCRYPTION_KEY: KEY_B, ENCRYPTION_KEY_VERSION: "1" });
    expect(() => openSecret(viejo, 1)).toThrow(DecryptError);
  });

  it("llavero mal armado: mensajes claros y sin valores", async () => {
    const { getKeyring } = await import("@/lib/crypto");
    setKeys({ ENCRYPTION_KEY: KEY_B, ENCRYPTION_KEY_VERSION: "2", ENCRYPTION_KEY_OLD: KEY_A });
    expect(() => getKeyring()).toThrow(/ENCRYPTION_KEY_OLD_VERSION no/);
    setKeys({ ENCRYPTION_KEY: KEY_B, ENCRYPTION_KEY_VERSION: "2", ENCRYPTION_KEY_OLD: KEY_A, ENCRYPTION_KEY_OLD_VERSION: "2" });
    expect(() => getKeyring()).toThrow(/distinta/);
    setKeys({ ENCRYPTION_KEY: KEY_B, ENCRYPTION_KEY_VERSION: "2", ENCRYPTION_KEY_OLD: KEY_B, ENCRYPTION_KEY_OLD_VERSION: "1" });
    try {
      getKeyring();
      expect.unreachable();
    } catch (err) {
      expect(String(err)).toMatch(/igual a ENCRYPTION_KEY/);
      expect(String(err)).not.toContain(KEY_B);
    }
  });

  it("ENCRYPTION_KEY_OLD que no son 32 bytes: el entorno no valida", async () => {
    const { getEnv } = await import("@/lib/env");
    setKeys({ ENCRYPTION_KEY: KEY_B, ENCRYPTION_KEY_OLD: "corta", ENCRYPTION_KEY_OLD_VERSION: "1", ENCRYPTION_KEY_VERSION: "2" });
    expect(() => getEnv()).toThrow(/ENCRYPTION_KEY_OLD debe ser 32 bytes/);
  });
});
