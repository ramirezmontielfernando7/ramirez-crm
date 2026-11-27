import { describe, expect, it } from "vitest";
import { fold, isPaletteShortcut, matchPages, shortcutLabel } from "@/lib/command-palette";

const pages = [
  { label: "Campañas", href: "/campaigns", group: "Marketing" },
  { label: "Contactos", href: "/contacts", group: "CRM Comercial" },
  { label: "Conectar WhatsApp", href: "/settings/whatsapp", group: "Ajustes" },
];

describe("Buscar (auditoría UX 2026-11, paquete C)", () => {
  it("no distingue mayúsculas ni acentos", () => {
    expect(fold("  CAMPAÑAS ")).toBe("campanas");
    expect(matchPages("campanas", pages).map((p) => p.href)).toEqual(["/campaigns"]);
  });

  it("busca también por el grupo y exige todas las palabras", () => {
    expect(matchPages("marketing", pages).map((p) => p.href)).toEqual(["/campaigns"]);
    expect(matchPages("conectar whats", pages).map((p) => p.href)).toEqual(["/settings/whatsapp"]);
    expect(matchPages("conectar campañas", pages)).toEqual([]);
  });

  it("sin texto enseña las primeras pantallas", () => {
    expect(matchPages("", pages, 2)).toHaveLength(2);
  });

  it("el atajo se escribe como en el teclado de quien mira", () => {
    expect(shortcutLabel("MacIntel")).toBe("⌘K");
    expect(shortcutLabel("Win32")).toBe("Ctrl K");
    expect(shortcutLabel(undefined)).toBe("Ctrl K");
  });

  it("Ctrl/⌘ K sin otros modificadores", () => {
    const k = { key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
    expect(isPaletteShortcut(k)).toBe(true);
    expect(isPaletteShortcut({ ...k, ctrlKey: false, metaKey: true })).toBe(true);
    expect(isPaletteShortcut({ ...k, shiftKey: true })).toBe(false);
    expect(isPaletteShortcut({ ...k, ctrlKey: false })).toBe(false);
  });
});
