import { describe, expect, it } from "vitest";
import { contactInitials, initials } from "@/lib/utils";

describe("contactInitials", () => {
  it("toma la primera y la última palabra, en mayúsculas", () => {
    expect(contactInitials("ana lópez")).toBe("AL");
    expect(contactInitials("María José Pérez Soto")).toBe("MS");
    expect(contactInitials("Ana")).toBe("A");
  });

  it("conserva las letras con acento y la ñ", () => {
    expect(contactInitials("Álvaro Núñez")).toBe("ÁN");
    expect(contactInitials("ñandú")).toBe("Ñ");
    // «é» descompuesta (e + acento combinante): sigue siendo UNA letra.
    expect(contactInitials("émile")).toBe("É");
  });

  it("no parte un emoji a la mitad (sin «�»)", () => {
    for (const name of ["😀 Marta Ruiz", "Fer 🔥", "👍", "🧑🏽‍💻 Luis", "🇲🇽 Pepe"]) {
      expect(contactInitials(name)).not.toMatch(/[\uD800-\uDFFF�]/);
    }
  });

  it("salta emojis y símbolos y usa solo letras o números", () => {
    expect(contactInitials("😀 Marta Ruiz")).toBe("MR");
    expect(contactInitials("Fer 🔥")).toBe("F");
    expect(contactInitials("🔥Fer")).toBe("F");
    expect(contactInitials("(Ana) [López]")).toBe("AL");
    expect(contactInitials("Cliente 2")).toBe("C2");
    expect(contactInitials("+52 55 1234")).toBe("51");
  });

  it("sin letras ni números usables, no hay iniciales", () => {
    expect(contactInitials("")).toBe("");
    expect(contactInitials("   ")).toBe("");
    expect(contactInitials("👍")).toBe("");
    expect(contactInitials("###")).toBe("");
    expect(contactInitials("😀 🔥 ***")).toBe("");
  });

  it("funciona con otros alfabetos", () => {
    expect(contactInitials("Иван Петров")).toBe("ИП");
    expect(contactInitials("李 雷")).toBe("李雷");
  });
});

describe("initials (con respaldo)", () => {
  it("devuelve «?» cuando no hay iniciales usables", () => {
    expect(initials("")).toBe("?");
    expect(initials("🔥")).toBe("?");
  });
  it("igual que contactInitials cuando sí las hay", () => {
    expect(initials("😀 Marta Ruiz")).toBe("MR");
  });
});
