import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Fluidez de la Bandeja, PR 2 — la lista de chats es VIRTUAL: solo se
 * dibujan las filas que se ven. El comportamiento en un navegador de verdad
 * (3,000 chats, teclado, búsqueda, enlace directo) lo prueba
 * scripts/e2e-bandeja-virtual.mjs; aquí se cuida que nadie regrese, sin
 * querer, al `visible.map` que pintaba miles de filas.
 */
describe("lista virtual de la Bandeja", () => {
  const fuente = readFileSync("src/components/inbox/conversation-list.tsx", "utf8");
  const css = readFileSync("src/app/globals.css", "utf8");

  it("pinta solo las filas de useVirtualizer, no la lista completa", () => {
    expect(fuente).toMatch(/useVirtualizer\(/);
    expect(fuente).toMatch(/getVirtualItems\(\)\.map/);
    expect(fuente).not.toMatch(/visible\.map\(/);
  });

  it("la fila se mide al pintarse (alto real, no uno fijo)", () => {
    expect(fuente).toMatch(/ref=\{measureRef\}/);
    expect(fuente).toMatch(/data-index=\{index\}/);
    expect(fuente).toMatch(/renderRow\(c, v, virtualizer\.measureElement\)/);
  });

  it("la clave de cada fila es el id del chat (no la posición)", () => {
    expect(fuente).toMatch(/getItemKey:\s*\(i\)\s*=>\s*visible\[i\]\?\.id/);
  });

  it("sin content-visibility en la fila: estorbaría la medición", () => {
    expect(css).not.toMatch(/\.inbox-row\s*\{[^}]*content-visibility/);
  });

  it("mantiene ul > li (los guiones E2E buscan las filas así)", () => {
    expect(fuente).toMatch(/<ul\s[^>]*onKeyDown=\{onListKeyDown\}/);
    expect(fuente).toMatch(/<li\s/);
  });

  it("el scroll vuelve a pintar solo la lista virtual, no los filtros", () => {
    // El virtualizador vive en VirtualRows, no en ConversationList.
    const lista = fuente.slice(fuente.indexOf("export const ConversationList"), fuente.indexOf("function VirtualRows"));
    expect(lista).not.toMatch(/useVirtualizer\(/);
    expect(lista).toMatch(/<VirtualRows/);
  });

  it("el chat abierto se trae a la vista y ↑/↓ recorren la lista", () => {
    expect(fuente).toMatch(/scrollToIndex\(i, \{ align: "auto" \}\)/);
    expect(fuente).toMatch(/e\.key !== "ArrowDown" && e\.key !== "ArrowUp"/);
  });
});
