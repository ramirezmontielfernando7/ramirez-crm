import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
const read = (...p: string[]) => readFileSync(path.join(SRC, ...p), "utf8");
const globals = read("app", "globals.css");
const css = read("app", "premium-c.css");

describe("Demfort Premium — Fase C: CRM Comercial", () => {
  it("globals.css importa premium-c.css con una sola línea, al inicio", () => {
    expect(globals.startsWith('@import "./premium-c.css";\n')).toBe(true);
    expect(globals.match(/premium-c\.css/g)).toHaveLength(1);
  });

  it("toda regla cuelga de [data-ui=\"premium\"] y «Clásico» no escribe nada", () => {
    const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectores = sinComentarios
      .split("\n")
      .filter((l) => /^\s*\[data-ui|^\s*[.:#a-z]/.test(l) && l.trim().endsWith("{") && !l.includes("@"));
    expect(selectores.length).toBeGreaterThan(5);
    for (const l of selectores) expect(l).toContain('[data-ui="premium"]');
    expect(css).not.toContain('[data-ui="classic"]');
  });

  it("sin sombras ni filtros pesados y con animaciones cortas de transform", () => {
    expect(css).not.toMatch(/filter\s*:|backdrop-filter|box-shadow:\s*0/);
    for (const m of css.matchAll(/transition:[^;]*?([\d.]+)s/g)) expect(parseFloat(m[1]!)).toBeLessThanOrEqual(0.32);
    expect(css).toContain("translateY(-2px)");
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*transition: none/);
  });

  it("los componentes solo añaden atributos data-pm que el CSS usa", () => {
    const pipeline = read("components", "pipeline", "pipeline-client.tsx");
    const contactos = read("components", "contacts", "contacts-client.tsx");
    for (const k of ["col", "col-head", "col-count", "amount"]) {
      expect(pipeline).toContain(`data-pm="${k}"`);
      expect(css).toContain(`[data-pm="${k}"]`);
    }
    expect(pipeline).toContain('data-pm={overlay ? "card-overlay" : "card"}');
    expect(contactos).toContain('data-pm="row"');
    expect(css).toContain('[data-pm="row"]');
  });
});
