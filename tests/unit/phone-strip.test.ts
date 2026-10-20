import { describe, expect, it } from "vitest";
import { stripPhoneAdornments } from "@/lib/phone-search";

describe("stripPhoneAdornments (Nuevo contacto)", () => {
  it("quita espacios, guiones, paréntesis, puntos y «+»", () => {
    expect(stripPhoneAdornments("52 462 134 9768")).toBe("524621349768");
    expect(stripPhoneAdornments("+52 462-134-9768")).toBe("524621349768");
    expect(stripPhoneAdornments(" (52) 462.134.9768 ")).toBe("524621349768");
  });
  it("deja en paz lo que ya son dígitos", () => {
    expect(stripPhoneAdornments("5215512345678")).toBe("5215512345678");
  });
  it("con letras u otros signos no adivina: lo devuelve para que se rechace", () => {
    expect(stripPhoneAdornments("52 462 abc")).toBe("52 462 abc");
    expect(stripPhoneAdornments("52#4621349768")).toBe("52#4621349768");
  });
  it("no agrega código de país", () => {
    expect(stripPhoneAdornments("462 134 9768")).toBe("4621349768");
  });
});
