import { describe, expect, it } from "vitest";
import { contactWhatsAppUrl, normalizeContactPhone } from "@/lib/plan-catalog";

describe("WhatsApp de contacto de la plataforma (0077)", () => {
  it("acepta 10 dígitos de México y les pone la lada", () => {
    expect(normalizeContactPhone("55 1234 5678")).toBe("525512345678");
    expect(normalizeContactPhone("(55) 1234-5678")).toBe("525512345678");
  });
  it("respeta un número completo con país", () => {
    expect(normalizeContactPhone("+52 1 55 1234 5678")).toBe("5215512345678");
    expect(normalizeContactPhone("+1 415 555 0100")).toBe("14155550100");
  });
  it("rechaza lo que no es un teléfono", () => {
    expect(normalizeContactPhone("")).toBeNull();
    expect(normalizeContactPhone("12345")).toBeNull();
    expect(normalizeContactPhone(null)).toBeNull();
    expect(normalizeContactPhone("1".repeat(16))).toBeNull();
  });
  it("arma el enlace con el mensaje codificado", () => {
    expect(contactWhatsAppUrl("525512345678", "Hola, ¿qué tal?")).toBe(
      "https://wa.me/525512345678?text=Hola%2C%20%C2%BFqu%C3%A9%20tal%3F"
    );
  });
});
