import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatTime } from "@/components/inbox/helpers";

/**
 * Fluidez de la Bandeja, PR 1 — la hora de cada fila sale de formateadores
 * creados UNA vez (antes, `toLocaleTimeString` armaba uno por fila) y el texto
 * no cambia: hora si es de hoy, «día mes» si no.
 */
describe("formatTime (hora de la fila de la Bandeja)", () => {
  const ahora = new Date(2026, 9, 21, 18, 30);

  it("hoy: misma salida que toLocaleTimeString", () => {
    const d = new Date(2026, 9, 21, 9, 5);
    expect(formatTime(d.toISOString(), ahora)).toBe(
      d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
    );
  });

  it("otro día (aunque sea la misma hora): misma salida que toLocaleDateString", () => {
    for (const d of [new Date(2026, 9, 20, 18, 30), new Date(2025, 9, 21, 9, 5), new Date(2026, 8, 21, 9, 5)]) {
      expect(formatTime(d.toISOString(), ahora)).toBe(
        d.toLocaleDateString("es-MX", { day: "numeric", month: "short" })
      );
    }
  });

  it("sin fecha o fecha rota: vacío", () => {
    expect(formatTime(null, ahora)).toBe("");
    expect(formatTime("no-es-fecha", ahora)).toBe("");
  });
});

describe("fila de la Bandeja sin animación de entrada", () => {
  const fuente = readFileSync("src/components/inbox/conversation-list.tsx", "utf8");

  it("la fila es un <li> normal con content-visibility (inbox-row), no m.li", () => {
    expect(fuente).not.toMatch(/<m\.li\b/);
    expect(fuente).toMatch(/className="inbox-row /);
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/\.inbox-row\s*\{[^}]*content-visibility:\s*auto/);
  });

  it("no crea formateadores de fecha por fila", () => {
    expect(fuente).not.toMatch(/toLocale(Date|Time)?String/);
  });
});
