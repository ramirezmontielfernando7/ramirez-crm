import {
  DecryptError,
  KeyUnavailableError,
  openSecret,
  sealSecret,
  type SealedValue,
} from "@/lib/crypto";

/**
 * Fase 3, PR 1 — El ÚNICO lugar fuera de `lib/crypto` que cifra o descifra.
 * Interno de `src/server/credentials/`: el resto del código guarda con
 * `sealForStorage` (de `./index`) y lee con `getOrgCredentials`. Guardarraíl:
 * `tests/unit/credentials-gate.test.ts`.
 */

export type { SealedValue };

export type OpenFailure = "decrypt_failed" | "key_unavailable";

export type Opened = { ok: true; value: string } | { ok: false; error: OpenFailure; keyVersion: number };

export function seal(plain: string): SealedValue {
  return sealSecret(plain);
}

/** Descifra sin lanzar: el error de una fila se reporta tipado. */
export function open(
  cipher: string,
  iv: string,
  tag: string,
  keyVersion: number
): Opened {
  try {
    return { ok: true, value: openSecret({ cipher, iv, tag }, keyVersion) };
  } catch (err) {
    if (err instanceof KeyUnavailableError) return { ok: false, error: "key_unavailable", keyVersion };
    if (err instanceof DecryptError) return { ok: false, error: "decrypt_failed", keyVersion };
    throw err;
  }
}
