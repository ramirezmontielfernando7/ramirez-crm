import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { avatarHue } from "@/components/avatar";
import { stageColorValue } from "@/lib/tags";

const css = readFileSync("src/app/premium-depth.css", "utf8");
const globals = readFileSync("src/app/globals.css", "utf8");

describe("Demfort Profundo (estilo de interfaz opcional)", () => {
  it("globals.css lo importa con una sola línea", () => {
    expect(globals.match(/premium-depth\.css/g)).toHaveLength(1);
  });

  it("cuelga solo de [data-ui=\"depth\"] (Clásico y Premium intactos)", () => {
    const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectores = [...sinComentarios.matchAll(/([^{}]+)\{/g)]
      .map((m) => (m[1] ?? "").trim())
      .filter((s) => !s.startsWith("@"));
    expect(selectores.length).toBeGreaterThan(20);
    for (const s of selectores) {
      for (const parte of s.split(",")) expect(parte, parte).toContain('[data-ui="depth"]');
    }
  });

  it("no escribe el acento a mano: sale del white-label", () => {
    expect(css).not.toMatch(/#12999d|#0e7c80/i);
    expect(css).toContain("var(--accent)");
  });

  it("no anima nada (sin transiciones nuevas)", () => {
    expect(css).not.toMatch(/transition|animation/);
  });

  it("el tono del avatar es estable y va de 0 a 5", () => {
    expect(avatarHue("ct_abc")).toBe(avatarHue("ct_abc"));
    const tonos = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((k) => avatarHue(`ct_${k}`)));
    for (const t of tonos) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(6);
    }
    expect(tonos.size).toBeGreaterThan(2);
  });

  it("el color de la etapa sale de su color guardado, su tipo o su nombre", () => {
    expect(stageColorValue("ambar", "Lo que sea")).toBe("#f59e0b");
    expect(stageColorValue(null, "Cliente nuevo", "won")).toBe("var(--success)");
    expect(stageColorValue(null, "Interesado", "open")).toBe("var(--warning)");
    expect(stageColorValue(null, "Otra", "open")).toBe("var(--text-3)");
  });
});
