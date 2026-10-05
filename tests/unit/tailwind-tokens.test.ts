import { describe, expect, it } from "vitest";
import config from "../../tailwind.config";

/**
 * Un color con el nombre de un tamaño de letra (`base`, `sm`, `lg`…) hace que
 * Tailwind genere `text-<nombre>` con tamaño Y color a la vez. Pasó con el
 * token `base` (fondo de la página): `text-base` pintaba el texto del color
 * del fondo y lo volvía invisible (número de destinatarios en Campañas,
 * editor del chat de equipo en el teléfono).
 */
const TAMANOS = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"];

describe("tokens de Tailwind", () => {
  it("ningún color se llama como un tamaño de letra", () => {
    const extend = (config.theme?.extend ?? {}) as Record<string, unknown>;
    const colors = Object.keys((extend.colors ?? {}) as Record<string, unknown>);
    const sizes = Object.keys((extend.fontSize ?? {}) as Record<string, unknown>);
    const choques = colors.filter((c) => TAMANOS.includes(c) || sizes.includes(c));
    expect(choques).toEqual([]);
  });
});
