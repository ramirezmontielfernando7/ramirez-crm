import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { PLATFORM_TABLES } from "@/lib/db/platform-tables";
import { TENANT_QUERY_EXCEPTIONS } from "./tenant-query-exceptions";

/**
 * Fase 1 multitenant (H23) — guardarraíl estático de consultas por
 * organización.
 *
 * Toda lectura, actualización o borrado sobre una tabla de dominio
 * (`.from(…)`, `.update(…)`, `.delete(…)`, `db.query.X.find…`) lleva
 * `scoped()`/`scopedContacts()`/`scopedConversations()`/`scopedMediaAssets()`
 * en la misma sentencia. Lo que no, está en `tenant-query-exceptions.ts` por
 * archivo, con cuántas son y por qué es seguro.
 *
 * Si estás aquí porque se puso rojo:
 *  - Consulta nueva → ponle `scoped(tabla.organizationId, orgId, …)`.
 *  - Quitaste una excepción → baja su `max` (la lista no guarda holgura: una
 *    excepción que sobra es un hueco donde cabe otra sin que nadie la revise).
 *  - Solo si de verdad no hay organización a mano (ruteo de webhook, arranque)
 *    súbela, con el motivo.
 *
 * Los `insert` no se vigilan aquí: `organization_id` es NOT NULL y cada fila
 * lo lleva explícito (y el PR 4 de la fase le suma `WITH CHECK` de RLS).
 */

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");

function archivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...archivosTs(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Quita comentarios conservando saltos de línea (los números de línea valen). */
function sinComentarios(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, pre: string) => pre + " ".repeat(m.length - pre.length));
}

const tablas = Object.entries(schema)
  .filter((e: [string, unknown]): e is [string, PgTable] => e[1] instanceof PgTable)
  .map(([exportName, t]) => ({ exportName, name: getTableConfig(t).name }));
const DOMINIO = tablas.filter((t) => !(t.name in PLATFORM_TABLES)).map((t) => t.exportName);

const SCOPED = /\bscoped(Contacts|Conversations|MediaAssets)?\(/;

type Hallazgo = { file: string; line: number; texto: string };

/** La sentencia desde `idx` hasta el `;` que la cierra. */
function sentencia(code: string, idx: number): string {
  const fin = code.indexOf(";", idx);
  return code.slice(idx, fin < 0 ? idx + 1500 : fin);
}

function escanear(): Map<string, Hallazgo[]> {
  const re = new RegExp(
    `\\.(?:from|update|delete)\\(\\s*(?:schema\\.)?(?:${DOMINIO.join("|")})\\b` +
      `|\\.query\\.(?:${DOMINIO.join("|")})\\.find`,
    "g"
  );
  const porArchivo = new Map<string, Hallazgo[]>();
  for (const file of archivosTs(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    if (rel === "lib/db/schema.ts") continue;
    const code = sinComentarios(readFileSync(file, "utf8"));
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const s = sentencia(code, m.index);
      if (SCOPED.test(s)) continue;
      const line = code.slice(0, m.index).split("\n").length;
      const lista = porArchivo.get(rel) ?? [];
      lista.push({ file: rel, line, texto: s.replace(/\s+/g, " ").slice(0, 120) });
      porArchivo.set(rel, lista);
    }
  }
  return porArchivo;
}

describe("guardarraíl: toda consulta de dominio va por organización", () => {
  const hallazgos = escanear();

  it("el detector ve tablas de dominio", () => {
    expect(DOMINIO.length).toBeGreaterThan(40);
    expect(DOMINIO).toContain("contact");
    expect(DOMINIO).not.toContain("organization");
  });

  it("cada consulta sin scoped() está en la lista de excepciones", () => {
    const mal: string[] = [];
    for (const [file, lista] of hallazgos) {
      const exc = TENANT_QUERY_EXCEPTIONS[file];
      if (!exc || lista.length > exc.max) {
        mal.push(
          `${file}: ${lista.length} sin scoped() (permitidas: ${exc?.max ?? 0})\n` +
            lista.map((h) => `    :${h.line}  ${h.texto}`).join("\n")
        );
      }
    }
    expect(mal, "\n" + mal.join("\n")).toEqual([]);
  });

  it("la lista de excepciones no tiene holgura", () => {
    const sobran: string[] = [];
    for (const [file, exc] of Object.entries(TENANT_QUERY_EXCEPTIONS)) {
      const n = hallazgos.get(file)?.length ?? 0;
      if (n < exc.max) sobran.push(`${file}: max ${exc.max}, hay ${n} — bájalo`);
    }
    expect(sobran).toEqual([]);
  });

  it("cada excepción explica por qué es segura", () => {
    const flojas = Object.entries(TENANT_QUERY_EXCEPTIONS)
      .filter(([, e]) => e.motivo.trim().length < 30)
      .map(([f]) => f);
    expect(flojas).toEqual([]);
  });
});

describe("guardarraíl: nada de «la primera organización»", () => {
  const archivos = archivosTs(SRC).map((f) => ({
    rel: path.relative(SRC, f).split(path.sep).join("/"),
    code: sinComentarios(readFileSync(f, "utf8")),
  }));

  /**
   * H2/H11: leer `organization` sin `where` es elegir un negocio al azar.
   * Solo se permite CONTAR (¿la instancia está vacía?), que no elige a nadie.
   */
  it("ninguna lectura de organization sin where (salvo un count)", () => {
    const mal: string[] = [];
    for (const { rel, code } of archivos) {
      const re = /\.from\(\s*schema\.organization\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        const s = sentencia(code, m.index);
        const antes = code.slice(Math.max(0, m.index - 200), m.index);
        if (/\.where\(/.test(s)) continue;
        if (/select\(\s*\{\s*\w+\s*:\s*count\(\)\s*\}\s*\)\s*$/.test(antes)) continue;
        mal.push(`${rel}:${code.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(mal, mal.join("\n")).toEqual([]);
  });

  /**
   * H4: la membresía de un usuario nunca es «la primera que salga». Dentro de
   * una organización (`member` es único por organización y usuario) un
   * `limit` no elige nada; sin organización, sí.
   */
  it("ninguna consulta a member sin organización con limit y sin orderBy", () => {
    const mal: string[] = [];
    for (const { rel, code } of archivos) {
      const re = /\.from\(\s*schema\.member\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        const s = sentencia(code, m.index);
        const conOrg = SCOPED.test(s) || /member\.organizationId/.test(s);
        if (!conOrg && /\.limit\(/.test(s) && !/\.orderBy\(/.test(s)) {
          mal.push(`${rel}:${code.slice(0, m.index).split("\n").length}`);
        }
      }
    }
    expect(mal, mal.join("\n")).toEqual([]);
  });
});
