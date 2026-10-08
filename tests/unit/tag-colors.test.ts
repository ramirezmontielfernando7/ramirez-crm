import { describe, expect, it } from "vitest";
import { TAG_COLORS, TAG_COLOR_CLASS, TAG_DOT_CLASS, tagColorClass, tagDotClass } from "@/lib/tags";

describe("colores de etiqueta en la Bandeja", () => {
  it("cada color de la paleta tiene su cápsula y su punto", () => {
    for (const c of TAG_COLORS) {
      expect(tagColorClass(c)).toBe(TAG_COLOR_CLASS[c]);
      expect(tagDotClass(c)).toBe(TAG_DOT_CLASS[c]);
    }
  });

  it("las variantes oscuras viajan con el color (verde, ámbar, rojo, morado)", () => {
    for (const c of ["verde", "ambar", "rojo", "morado"] as const) {
      expect(tagColorClass(c)).toContain("dark:");
    }
  });

  it("nulo, vacío o inválido cae al gris", () => {
    for (const bad of [null, undefined, "", "fucsia", "ROJO"]) {
      expect(tagColorClass(bad)).toBe(TAG_COLOR_CLASS.gris);
      expect(tagDotClass(bad)).toBe(TAG_DOT_CLASS.gris);
    }
  });
});
