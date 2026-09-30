import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatLogLine } from "@/lib/log";
import { runWithOrganization } from "@/lib/request-context";

/**
 * H27 — Los logs del servidor salen por `src/lib/log.ts`: con la
 * organización en cada línea y sin errores crudos (con drizzle traen el SQL y
 * sus parámetros: teléfonos, textos). Los componentes de cliente
 * ("use client") quedan fuera: su consola es la del navegador.
 */
const SRC = path.resolve(import.meta.dirname, "..", "..", "src");

function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const f = path.join(dir, e);
    if (statSync(f).isDirectory()) out.push(...archivos(f));
    else if (/\.(ts|tsx)$/.test(e)) out.push(f);
  }
  return out;
}

describe("guardarraíl: los logs del servidor van por el logger", () => {
  it("ningún console.* en código de servidor fuera de lib/log.ts", () => {
    const mal: string[] = [];
    for (const f of archivos(SRC)) {
      const rel = path.relative(SRC, f).split(path.sep).join("/");
      if (rel === "lib/log.ts") continue;
      const code = readFileSync(f, "utf8");
      if (/^\s*["']use client["']/.test(code)) continue;
      code.split("\n").forEach((l, i) => {
        if (/\bconsole\.(log|warn|error|info|debug)\(/.test(l) && !/^\s*(\/\/|\*)/.test(l)) {
          mal.push(`${rel}:${i + 1}`);
        }
      });
    }
    expect(mal, "Usa logger() de src/lib/log.ts:\n" + mal.join("\n")).toEqual([]);
  });
});

describe("formatLogLine", () => {
  it("lleva la organización explícita", () => {
    expect(formatLogLine("webhook", "descartado", { org: "org_a", mensaje: "wamid.1" })).toBe(
      "[webhook] descartado org=org_a mensaje=wamid.1"
    );
  });

  it("sin org explícita toma la del contexto de la request", () => {
    const linea = runWithOrganization("org_ctx", () => formatLogLine("api", "error no controlado"));
    expect(linea).toBe("[api] error no controlado org=org_ctx");
  });

  it("fuera de una request, sin org", () => {
    expect(formatLogLine("boot", "listo")).toBe("[boot] listo");
  });

  it("un error de BD sale sin SQL ni parámetros", () => {
    const err = Object.assign(new Error('Failed query: insert into "contact" … params: 5215512345678,Hola secreto'), {
      query: 'insert into "contact"',
      params: ["5215512345678", "Hola secreto"],
      cause: { code: "23505", table_name: "contact", constraint_name: "contact_uq", severity: "ERROR" },
    });
    const linea = formatLogLine("api", "falló", { org: "org_a", err });
    expect(linea).toContain("código 23505");
    expect(linea).not.toContain("5215512345678");
    expect(linea).not.toContain("Hola secreto");
  });

  it("solo escalares: un objeto (p. ej. un mensaje entero) no se vuelca", () => {
    const linea = formatLogLine("x", "y", { org: "org_a", mensaje: { texto: "privado", tel: "5215512345678" } });
    expect(linea).toBe("[x] y org=org_a");
  });

  it("los valores largos se recortan y los que tienen espacios van entre comillas", () => {
    const linea = formatLogLine("x", "y", { motivo: "a b", largo: "z".repeat(500) });
    expect(linea).toContain('motivo="a b"');
    expect(linea.length).toBeLessThan(200);
  });
});
