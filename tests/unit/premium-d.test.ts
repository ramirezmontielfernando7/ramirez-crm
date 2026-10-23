import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const css = read("src/app/premium-d.css");

describe("Demfort Premium · Fase D (Marketing e Inteligencia)", () => {
  it("globals.css importa el archivo con una sola línea", () => {
    const lines = read("src/app/globals.css").split("\n").filter((l) => l.includes("premium-d.css"));
    expect(lines).toEqual(['@import "./premium-d.css";']);
  });

  it("toda regla cuelga de [data-ui=\"premium\"]: «Clásico» no escribe nada", () => {
    const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectores = sinComentarios.match(/^[^\s@}][^{]*\{/gm) ?? [];
    expect(selectores.length).toBeGreaterThan(0);
    for (const s of selectores) expect(s).toContain('[data-ui="premium"]');
  });

  it("es solo visual y ligero: sin sombras, filtros ni animaciones nuevas", () => {
    expect(css).not.toMatch(/filter\s*:|backdrop|@keyframes|animation\s*:/);
    for (const m of css.matchAll(/box-shadow:\s*([^;]+);/g)) expect(m[1]).toBe("none");
  });

  it("los ganchos data-pm existen en los componentes", () => {
    const f = (p: string, h: string) => expect(read(p)).toContain(h);
    f("src/components/results/stat-card.tsx", 'data-pm="tile-value"');
    f("src/components/results/section.tsx", 'data-pm="panel"');
    f("src/components/results/funnel.tsx", 'data-pm="bar"');
    f("src/components/campaigns/campaigns-client.tsx", 'data-pm="row"');
    f("src/components/campaigns/status-badge.tsx", 'data-pm="status"');
    for (const h of css.match(/data-pm="[a-z-]+"/g) ?? []) {
      const found = ["results/stat-card.tsx", "results/section.tsx", "results/funnel.tsx", "campaigns/campaigns-client.tsx", "campaigns/status-badge.tsx"].some((p) => read(`src/components/${p}`).includes(h));
      expect(found, h).toBe(true);
    }
  });
});
