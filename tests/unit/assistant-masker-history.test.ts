import { describe, expect, it } from "vitest";
import { Masker } from "@/lib/assistant-engine";

describe("el historial del asistente recuerda a quién se refería", () => {
  it("renumera las fichas viejas con las de la pregunta nueva, sin mezclar personas", () => {
    // Ayer: Angela fue [CONTACTO 1].
    const ayer = new Masker();
    const t = ayer.name("contact", "Angela Pico")!;
    expect(t).toBe("[CONTACTO 1]");
    const masks = ayer.entries();

    // Hoy: otra persona ya es [CONTACTO 1].
    const hoy = new Masker();
    expect(hoy.name("contact", "Sarina Rodríguez")).toBe("[CONTACTO 1]");
    const nuevo = hoy.learn("[CONTACTO 1]", masks["[CONTACTO 1]"]!);
    expect(nuevo).toBe("[CONTACTO 2]");
    expect(hoy.unmask(nuevo)).toBe("Angela Pico");
    // Y un nombre suelto en la pregunta nueva ya se reconoce.
    expect(hoy.text("responde a Angela")).toContain("[CONTACTO 2]");
  });

  it("ignora fichas que no existen", () => {
    expect(new Masker().learn("[OTRA COSA 1]", "x")).toBe("[OTRA COSA 1]");
  });
});
