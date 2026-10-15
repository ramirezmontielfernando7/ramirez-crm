import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 040 — Biblioteca unificada: el puente (`src/server/library/`) NO toca
 * tablas; solo llama a las dos puertas (`server/knowledge/store.ts` y
 * `server/kb-docs/store.ts`), así que sus límites, el candado de la
 * organización y el `scoped()` valen igual. Y lo que se ENVÍA desde la
 * Bandeja o el chat de equipo pasa por `getKnowledgeForChat`: un original
 * guardado solo para la IA no sale.
 */
const SRC = path.resolve(import.meta.dirname, "..", "..", "src");

function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...archivos(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("040 — puente de la Biblioteca unificada", () => {
  it.each(archivos(path.join(SRC, "server", "library")).map((f) => path.relative(SRC, f)))("%s no consulta tablas", (rel) => {
    const src = readFileSync(path.join(SRC, rel), "utf8");
    expect(src).not.toMatch(/\bgetDb\(|getSystemDb\(|withTenant\(|\.(?:insert|update|delete|from)\(\s*schema\./);
  });

  it("solo store.ts de Conocimientos consulta knowledgeEntry", () => {
    const re = /\.(?:insert|update|delete|from|innerJoin|leftJoin)\(\s*(?:schema\.)?knowledgeEntry\b/;
    const fuera = archivos(SRC)
      .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
      .filter((rel) => re.test(readFileSync(path.join(SRC, rel), "utf8")))
      .filter((rel) => rel !== "server/knowledge/store.ts" && rel !== "server/usage/storage.ts");
    expect(fuera).toEqual([]);
  });

  it.each([
    "app/api/conversations/[id]/messages/knowledge/route.ts",
    "app/api/team-chat/threads/[id]/messages/knowledge/route.ts",
  ])("%s envía solo lo que aparece en la Bandeja", (rel) => {
    const src = readFileSync(path.join(SRC, rel), "utf8");
    expect(src).toContain("getKnowledgeForChat(");
    expect(src).not.toMatch(/\bgetKnowledge\(/);
  });
});
