import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 031 — `kb_entry` (el conocimiento que lee el agente) tiene UNA puerta de
 * escritura: `src/server/agents/kb.ts`. Ahí se decide a qué agente pertenece
 * cada entrada (y, desde el PR C, su texto de búsqueda). Quien escriba por
 * otro lado se salta esas reglas.
 */

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");

/** Las excepciones, con su motivo. */
const PERMITIDOS: Record<string, string> = {
  "server/agents/kb.ts": "La puerta.",
  "server/seed/demo.ts":
    "Seed de la demo: borra y re-siembra el conocimiento COMPARTIDO de su organización en bloque (idempotente); no toca el de ningún agente.",
};

function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...archivos(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("031 — puerta única de escritura de kb_entry", () => {
  it("solo src/server/agents/kb.ts (y las excepciones anotadas) escriben kb_entry", () => {
    const re = /\.(?:insert|update|delete)\(\s*(?:schema\.)?kbEntry\b/;
    const fuera = archivos(SRC)
      .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
      .filter((rel) => re.test(readFileSync(path.join(SRC, rel), "utf8")))
      .filter((rel) => !(rel in PERMITIDOS));
    expect(fuera).toEqual([]);
  });
});
