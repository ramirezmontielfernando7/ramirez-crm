import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 035 — `kb_document` y `kb_chunk` tienen UNA puerta: `src/server/kb-docs/store.ts`.
 * Ahí viven los límites (con el candado de la organización) y el `scoped()`
 * de cada consulta. Quien lea o escriba por otro lado se los salta.
 * 037: también `kb_document_group` (los grupos).
 */
const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
const PUERTA = "server/kb-docs/store.ts";

function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...archivos(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("035 — puerta única de los documentos del agente", () => {
  it("solo store.ts usa kbDocument / kbChunk / kbDocumentLimit / kbDocumentGroup en consultas (y limits.ts para leer los límites)", () => {
    const re = /\.(?:insert|update|delete|from|innerJoin|leftJoin)\(\s*(?:schema\.)?(kbDocument|kbChunk|kbDocumentLimit|kbDocumentGroup)\b/;
    const fuera = archivos(SRC)
      .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
      .filter((rel) => re.test(readFileSync(path.join(SRC, rel), "utf8")))
      .filter((rel) => rel !== PUERTA && rel !== "server/kb-docs/limits.ts");
    expect(fuera).toEqual([]);
  });

  it("limits.ts solo LEE kb_document_limit", () => {
    const src = readFileSync(path.join(SRC, "server/kb-docs/limits.ts"), "utf8");
    expect(src).not.toMatch(/\.(?:insert|update|delete)\(/);
  });
});
