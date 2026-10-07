import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  contactLabel,
  looksLikePhone,
  normalizeTypedPhone,
  prettyPhone,
} from "@/lib/phone-search";

vi.mock("@/components/viewer-context", () => ({
  useViewer: () => ({ can: () => true, hasModule: () => true }),
}));
const { UnregisteredNumberCard } = await import("@/components/inbox/unregistered-number");

/**
 * «Número no registrado»: cuándo aparece la tarjeta (solo con teléfonos),
 * cómo se normaliza el número y que el nombre nunca quede vacío.
 */

describe("looksLikePhone", () => {
  it.each(["5512345678", "+52 55 1234 5678", "(55) 1234-5678", "521 55 1234 5678", "1234567"])(
    "%s parece teléfono",
    (q) => expect(looksLikePhone(q)).toBe(true)
  );
  it.each(["", "   ", "Juan", "Juan 5512345", "123456", "+52 55", "a1234567", "55-12"])(
    "«%s» NO parece teléfono",
    (q) => expect(looksLikePhone(q)).toBe(false)
  );
});

describe("normalizeTypedPhone", () => {
  it("con y sin el 1 de México da el mismo número", () => {
    const todos = ["5215512345678", "525512345678", "+52 55 1234 5678", "+521 55 1234 5678", "(55) 1234-5678", "5512345678", "0052 55 1234 5678"];
    for (const t of todos) {
      expect(normalizeTypedPhone(t)).toMatchObject({ phone: "525512345678", valid: true });
    }
  });
  it("respeta otros países cuando el código viene escrito", () => {
    expect(normalizeTypedPhone("+1 415 555 2671")).toMatchObject({ phone: "14155552671", valid: true });
  });
  it("explica en español por qué no sirve", () => {
    expect(normalizeTypedPhone("5551234").valid).toBe(false);
    expect(normalizeTypedPhone("5551234").problem).toMatch(/lada/);
    expect(normalizeTypedPhone("+52 55 1234").problem).toMatch(/10 dígitos/);
    expect(normalizeTypedPhone("1234567890123456").problem).toMatch(/largo/);
  });
  it("lo muestra legible", () => {
    expect(prettyPhone("525512345678")).toBe("+52 55 1234 5678");
    expect(prettyPhone("14155552671")).toBe("+14155552671");
  });
});

describe("contactLabel: nunca vacío ni «undefined»", () => {
  it("usa el nombre; si no hay, el teléfono", () => {
    expect(contactLabel({ name: "Lupita", phone: "525512345678" })).toBe("Lupita");
    expect(contactLabel({ name: "", phone: "525512345678" })).toBe("+525512345678");
    expect(contactLabel({ name: "   ", phone: "525512345678" })).toBe("+525512345678");
    expect(contactLabel({ name: undefined, phone: "525512345678" })).toBe("+525512345678");
    expect(contactLabel({ name: null, phone: null })).toBe("Sin nombre");
  });
  it("un contacto sin nombre (el teléfono guardado como nombre) se lee con +", () => {
    expect(contactLabel({ name: "525512345678", phone: "525512345678" })).toBe("+525512345678");
  });
  it("jamás imprime «undefined»", () => {
    expect(contactLabel({})).not.toMatch(/undefined|null/);
  });
});

describe("tarjeta «Este número no está registrado»", () => {
  const html = (q: string) => renderToStaticMarkup(createElement(UnregisteredNumberCard, { query: q, onOpenChat: () => {} }));

  it("muestra el título, el número normalizado y los tres botones", () => {
    const out = html("55 1234 5678");
    expect(out).toContain("Este número no está registrado");
    expect(out).toContain("+52 55 1234 5678");
    expect(out).toContain("Registrar contacto");
    expect(out).toContain("Abrir chat");
    expect(out).toContain("Enviar mensaje");
  });
  it("con un teléfono que no se puede registrar, explica y deshabilita", () => {
    const out = html("5551234");
    expect(out).toContain("Falta la lada");
    expect(out.match(/disabled=""/g)?.length).toBe(3);
  });
});
