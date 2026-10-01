import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * Cifrado en reposo de secretos (tokens, secretos de webhook) con AES-256-GCM.
 * GCM aporta integridad además de confidencialidad: si el tag no coincide,
 * el descifrado lanza (dato manipulado o clave incorrecta).
 *
 * Fase 3, PR 1 — LLAVE VERSIONADA. Cada valor cifrado guarda con qué versión
 * de llave se cifró (`key_version` en su fila). El llavero sale del entorno:
 *
 * - `ENCRYPTION_KEY` + `ENCRYPTION_KEY_VERSION` (default 1): la llave ACTUAL.
 *   Todo lo nuevo se cifra con ella.
 * - `ENCRYPTION_KEY_OLD` + `ENCRYPTION_KEY_OLD_VERSION`: la anterior, SOLO
 *   durante una rotación. Sirve para leer lo que aún no se re-cifró; el
 *   arranque re-cifra (`src/server/credentials/maintenance.ts`).
 *
 * Solo `src/server/credentials/` importa este módulo (guardarraíl en
 * `tests/unit/credentials-gate.test.ts`). Nunca registres una llave.
 */

export type EncryptedValue = {
  cipher: string; // base64
  iv: string; // base64 (12 bytes)
  tag: string; // base64 (16 bytes)
};

export type SealedValue = EncryptedValue & { keyVersion: number };

/** La fila se cifró con una versión de llave que este proceso no tiene. */
export class KeyUnavailableError extends Error {
  constructor(readonly keyVersion: number) {
    super(`llave de cifrado versión ${keyVersion} no disponible (ENCRYPTION_KEY_VERSION / ENCRYPTION_KEY_OLD_VERSION)`);
    this.name = "KeyUnavailableError";
  }
}

/** La llave existe pero no descifra (tag inválido: dato manipulado o llave equivocada). */
export class DecryptError extends Error {
  constructor(readonly keyVersion: number) {
    super(`no se pudo descifrar con la llave versión ${keyVersion}`);
    this.name = "DecryptError";
  }
}

export type Keyring = {
  current: { version: number; key: Buffer };
  previous: { version: number; key: Buffer } | null;
};

function decodeKey(name: string, raw: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`${name} debe ser 32 bytes en base64`);
  return key;
}

/** El llavero del entorno. Lanza con un mensaje claro (sin valores) si está mal armado. */
export function getKeyring(): Keyring {
  const env = getEnv();
  const current = {
    version: env.ENCRYPTION_KEY_VERSION,
    key: decodeKey("ENCRYPTION_KEY", env.ENCRYPTION_KEY),
  };
  if (!env.ENCRYPTION_KEY_OLD) return { current, previous: null };
  if (env.ENCRYPTION_KEY_OLD_VERSION === undefined) {
    throw new Error("ENCRYPTION_KEY_OLD está definida pero ENCRYPTION_KEY_OLD_VERSION no");
  }
  if (env.ENCRYPTION_KEY_OLD_VERSION === current.version) {
    throw new Error("ENCRYPTION_KEY_OLD_VERSION debe ser distinta de ENCRYPTION_KEY_VERSION");
  }
  const previous = {
    version: env.ENCRYPTION_KEY_OLD_VERSION,
    key: decodeKey("ENCRYPTION_KEY_OLD", env.ENCRYPTION_KEY_OLD),
  };
  if (previous.key.equals(current.key)) {
    throw new Error("ENCRYPTION_KEY_OLD es igual a ENCRYPTION_KEY: no hay nada que rotar; quita ENCRYPTION_KEY_OLD");
  }
  return { current, previous };
}

/** Versión de la llave con la que se cifra lo nuevo. */
export function currentKeyVersion(): number {
  return getKeyring().current.version;
}

function keyFor(version: number): Buffer {
  const ring = getKeyring();
  if (ring.current.version === version) return ring.current.key;
  if (ring.previous?.version === version) return ring.previous.key;
  throw new KeyUnavailableError(version);
}

/** Cifra con la llave ACTUAL y dice con qué versión. */
export function sealSecret(plain: string): SealedValue {
  const { version, key } = getKeyring().current;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    cipher: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion: version,
  };
}

/**
 * Descifra con la llave de `keyVersion`. Lanza `KeyUnavailableError` si este
 * proceso no la tiene y `DecryptError` si no descifra.
 */
export function openSecret(value: EncryptedValue, keyVersion: number): string {
  const key = keyFor(keyVersion);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(value.cipher, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    throw new DecryptError(keyVersion);
  }
}
