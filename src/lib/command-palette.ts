/**
 * Auditoría UX 2026-11 (paquete C, punto 4) — «Buscar» de verdad: reglas puras
 * de la paleta (Ctrl/⌘ K). Buscar no distingue mayúsculas ni acentos.
 */
export const OPEN_PALETTE_EVENT = "vocero:open-palette";
export const OPEN_ASSISTANT_EVENT = "vocero:open-assistant";

/** `keywords`: otros nombres con que se busca (p. ej. el nombre viejo de un renglón). */
export type PalettePage = { label: string; href: string; group: string; keywords?: string };

export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** Pantallas cuyo nombre (o el de su grupo) contiene cada palabra buscada. */
export function matchPages(query: string, pages: readonly PalettePage[], max = 6): PalettePage[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return pages.slice(0, max);
  return pages
    .filter((p) => {
      const hay = fold(`${p.label} ${p.group} ${p.keywords ?? ""}`);
      return words.every((w) => hay.includes(w));
    })
    .slice(0, max);
}

/** «⌘K» en Mac y iPad; «Ctrl K» en los demás. */
export function shortcutLabel(platform: string | undefined): string {
  return /mac|iphone|ipad|ipod/i.test(platform ?? "") ? "⌘K" : "Ctrl K";
}

/** ¿El atajo de la paleta? (Ctrl/⌘ + K, sin más modificadores). */
export function isPaletteShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
}
