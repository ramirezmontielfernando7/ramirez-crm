import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Fase 3, PR 1 — Puerta única de credenciales. Cifrar y descifrar secretos
 * solo pasa dentro de `src/server/credentials/`: ningún otro archivo importa
 * `@/lib/crypto` ni el `vault` interno. Quien necesite un token lo pide con
 * `getOrgCredentials` (y guarda con `sealForStorage`).
 *
 * Si estás aquí porque esto se puso rojo: usa `getOrgCredentials(org, tipo)`
 * de `@/server/credentials`.
 */
const RAIZ = path.resolve(import.meta.dirname, "../..");
const PUERTA = "src/server/credentials/";

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.(ts|tsx|mjs)$/.test(n) ? [p] : [];
  });
}

describe("credenciales: una sola puerta", () => {
  it("nadie fuera de src/server/credentials/ importa lib/crypto ni el vault", () => {
    const mal: string[] = [];
    for (const abs of archivos(path.join(RAIZ, "src"))) {
      const rel = path.relative(RAIZ, abs).split(path.sep).join("/");
      if (rel.startsWith(PUERTA) || rel.startsWith("src/lib/crypto/")) continue;
      const src = readFileSync(abs, "utf8");
      if (/from\s+["']@\/lib\/crypto["']/.test(src)) mal.push(`${rel}: importa @/lib/crypto`);
      if (/from\s+["']@\/server\/credentials\/vault["']/.test(src)) mal.push(`${rel}: importa el vault`);
      if (/\b(openSecret|decryptSecret)\s*\(/.test(src)) mal.push(`${rel}: descifra por su cuenta`);
    }
    expect(mal, mal.join("\n")).toEqual([]);
  });

  it("toda tabla con columnas *_cipher tiene key_version (si no, no se puede rotar)", () => {
    const schema = readFileSync(path.join(RAIZ, "src/lib/db/schema.ts"), "utf8");
    const tablas = schema.split(/export const \w+ = pgTable\(/).slice(1);
    const mal = tablas
      .filter((t) => /_cipher"/.test(t) && !/key_version"/.test(t))
      .map((t) => t.slice(0, 60).split("\n")[0]);
    expect(mal, mal.join("\n")).toEqual([]);
  });
});
