import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
const read = (...p: string[]) => readFileSync(path.join(SRC, ...p), "utf8");
const css = read("app", "premium-e.css");

describe("Demfort Premium · Fase E", () => {
  it("se importa con una sola línea desde globals.css, antes de las reglas", () => {
    const globals = read("app", "globals.css");
    expect(globals).toContain('@import "./premium-e.css";');
    expect(globals.indexOf('@import "./premium-e.css";')).toBeLessThan(globals.indexOf("@tailwind base;"));
    expect(globals.match(/premium-e\.css/g)).toHaveLength(1);
  });

  it("todas las reglas cuelgan de [data-ui=premium] y de un área (Clásico intacto)", () => {
    const lineas = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => (l.endsWith("{") || l.endsWith(",")) && !l.startsWith("@") && !/^(from|to)\b/.test(l));
    expect(lineas.length).toBeGreaterThan(0);
    for (const l of lineas) expect(l.startsWith('[data-ui="premium"] [data-premium-area]')).toBe(true);
  });

  it("sin sombras ni filtros pesados y con reducción de movimiento", () => {
    expect(css).not.toMatch(/filter\s*:|backdrop-filter/);
    expect(css).not.toMatch(/box-shadow:\s*0/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).toMatch(/animation: pm-enter 0\.28s/);
  });

  it("Laboratorio y Ajustes marcan su área", () => {
    expect(read("components", "lab", "lab-shell.tsx")).toContain('data-premium-area="lab"');
    expect(read("components", "settings", "settings-nav.tsx")).toContain('data-premium-area="settings"');
  });
});
