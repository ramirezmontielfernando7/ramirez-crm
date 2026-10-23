import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/premium-f.css", "utf8");
const globals = readFileSync("src/app/globals.css", "utf8");

describe("Demfort Premium · animaciones (fase F)", () => {
  it("globals.css la importa con una sola línea", () => {
    expect(globals.match(/premium-f\.css/g)).toHaveLength(1);
  });

  it("cuelga solo de [data-ui=\"premium\"] (Clásico intacto)", () => {
    const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectores = [...sinComentarios.matchAll(/([^{}]+)\{/g)]
      .map((m) => m[1].trim())
      .filter((s) => !s.startsWith("@") && !/^(from|to)$/.test(s));
    for (const s of selectores) {
      if (s === ":root") continue;
      expect(s, s).toContain('[data-ui="premium"]');
    }
  });

  it("solo anima opacidad y transform, en ≤ 320 ms", () => {
    expect(css).not.toMatch(/transition:[^;]*(color|background|shadow|width|height)/);
    for (const m of css.matchAll(/(\d*\.?\d+)s\b/g)) {
      expect(Number(m[1]) * 1000).toBeLessThanOrEqual(320);
    }
  });

  it("se apaga con prefers-reduced-motion", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
