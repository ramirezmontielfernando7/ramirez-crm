import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ModuleKey } from "@/lib/modules/registry";

/**
 * 030 (PR 4) — Vigilancia: cada ruta de un módulo que la plataforma puede
 * apagar responde 404 cuando está apagado (`moduleOff`), en CADA handler y
 * después del permiso. Una ruta nueva bajo estas carpetas sin la guardia
 * pone esto en rojo. (Ocultar en el menú no las protege: es solo estético.)
 */

const API = path.resolve(import.meta.dirname, "..", "..", "src", "app", "api");
const APP = path.resolve(import.meta.dirname, "..", "..", "src", "app", "(app)");

const CARPETAS: [string, ModuleKey[]][] = [
  ["knowledge", ["knowledge"]],
  ["conversations/[id]/messages/knowledge", ["knowledge"]],
  ["team-chat/threads/[id]/messages/knowledge", ["team_chat", "knowledge"]],
  ["team-chat", ["team_chat"]],
  ["kb", ["agent"]],
  ["agent/profile", ["agent"]],
  ["lab", ["lab"]],
  ["analytics", ["results"]],
];

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

function llavesPara(file: string): ModuleKey[] {
  const rel = path.relative(API, path.dirname(file)).split(path.sep).join("/");
  // La carpeta más específica gana.
  const hit = CARPETAS.filter(([c]) => rel === c || rel.startsWith(`${c}/`)).sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? hit[1] : [];
}

describe("030 (PR 4) — rutas de módulos apagables", () => {
  const archivos = CARPETAS.flatMap(([c]) => routeFiles(path.join(API, c)));

  it("hay rutas que vigilar", () => {
    expect(archivos.length).toBeGreaterThan(20);
  });

  it.each(archivos.map((f) => [path.relative(API, f), f]))("%s: cada handler pregunta por su módulo", (_rel, file) => {
    const code = readFileSync(file, "utf8");
    const handlers = code.split(/\nexport const (?:GET|POST|PUT|PATCH|DELETE) = /).slice(1);
    expect(handlers.length).toBeGreaterThan(0);
    for (const h of handlers) {
      for (const key of llavesPara(file)) {
        expect(h, `${path.relative(API, file)} · ${key}`).toContain(`moduleOff(session.organizationId, "${key}")`);
      }
    }
  });

  it.each([
    ["knowledge", "knowledge"],
    ["chat", "team_chat"],
    ["agent", "agent"],
    ["lab", "lab"],
    ["results", "results"],
  ])("la página /%s responde 404 sin el módulo %s", (page, key) => {
    const code = readFileSync(path.join(APP, page, "page.tsx"), "utf8");
    expect(code).toContain(`requireModulePage("${key}")`);
  });
});
