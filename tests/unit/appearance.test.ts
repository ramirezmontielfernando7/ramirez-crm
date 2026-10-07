import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CHAT_STYLES,
  DEFAULT_APPEARANCE,
  FONT_KEYS,
  FONT_LABELS,
  normalizeOrgAppearance,
  readPersonalAppearance,
  resolveAppearance,
} from "@/lib/appearance";
import { MessageBubble } from "@/components/inbox/message-bubble";
import type { MessageDto } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
import { AppearanceClient } from "@/components/settings/appearance-client";

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
const css = readFileSync(path.join(SRC, "app", "globals.css"), "utf8");
const layout = readFileSync(path.join(SRC, "app", "layout.tsx"), "utf8");

function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...archivos(full));
    else if (/\.(tsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("Fase D — selector de tipografía", () => {
  it("ofrece exactamente Inter, Geist, Plus Jakarta Sans y DM Sans", () => {
    expect(FONT_KEYS.map((k) => FONT_LABELS[k])).toEqual(["Inter", "Geist", "Plus Jakarta Sans", "DM Sans"]);
  });

  it("cada letra distinta de Inter tiene su regla [data-font] y su paquete local", () => {
    for (const k of FONT_KEYS.filter((k) => k !== "inter")) {
      expect(css, k).toContain(`[data-font="${k}"]`);
    }
    for (const pkg of ["geist", "plus-jakarta-sans", "dm-sans"]) {
      expect(layout).toContain(`@fontsource-variable/${pkg}`);
    }
  });

  it("ninguna letra se pide a Google en runtime (solo next/font en build, para Inter)", () => {
    for (const file of archivos(SRC)) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    }
  });

  it("valores desconocidos o manipulados caen al de fábrica sin lanzar", () => {
    expect(normalizeOrgAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeOrgAppearance({ font: "comic-sans", chatStyle: 7 })).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeOrgAppearance({ font: "geist", chatStyle: "whatsapp" })).toEqual({ font: "geist", chatStyle: "whatsapp" });
  });

  it("la preferencia personal pisa a la de la organización, solo para esa persona", () => {
    const org = { font: "geist", chatStyle: "classic" } as const;
    expect(resolveAppearance(org, readPersonalAppearance({}))).toEqual(org);
    expect(resolveAppearance(org, readPersonalAppearance({ font: "dmsans" }))).toEqual({ font: "dmsans", chatStyle: "classic" });
    // Una cookie inválida se ignora y se sigue a la organización.
    expect(resolveAppearance(org, readPersonalAppearance({ font: "zzz", chatStyle: "zzz" }))).toEqual(org);
  });

  it("la pantalla muestra las cuatro letras, el aviso del navegador y el nivel de organización solo a quien administra", () => {
    const org = DEFAULT_APPEARANCE;
    const none = { font: null, chatStyle: null };
    const soloYo = renderToStaticMarkup(createElement(AppearanceClient, { org, personal: none, canManageOrg: false }));
    for (const label of Object.values(FONT_LABELS)) expect(soloYo).toContain(label);
    expect(soloYo).toContain("solo en este navegador por ahora");
    expect(soloYo).not.toContain("Toda la organización");
    const admin = renderToStaticMarkup(createElement(AppearanceClient, { org, personal: none, canManageOrg: true }));
    expect(admin).toContain("Toda la organización");
  });
});

describe("Fase D — estilo del chat", () => {
  const dto = (direction: "in" | "out"): MessageDto => ({
    id: "m", conversationId: "c", direction, type: "text", text: "hola", status: "read",
    error: null, aiGenerated: false, origin: "operator", media: null, createdAt: new Date().toISOString(),
  });

  it("hay dos estilos y «Clásico» es el de fábrica", () => {
    expect([...CHAT_STYLES]).toEqual(["classic", "whatsapp"]);
    expect(DEFAULT_APPEARANCE.chatStyle).toBe("classic");
  });

  it("la burbuja lleva los ganchos que el estilo WhatsApp usa (dirección y cola solo en el primero)", () => {
    const primero = renderToStaticMarkup(createElement(MessageBubble, { m: dto("out"), grouped: false }));
    expect(primero).toMatch(/class="[^"]*\bbubble\b[^"]*\bbubble-out\b[^"]*\bbubble-first\b/);
    const seguido = renderToStaticMarkup(createElement(MessageBubble, { m: dto("in"), grouped: true }));
    expect(seguido).toContain("bubble-in");
    expect(seguido).not.toContain("bubble-first");
  });

  it("«WhatsApp» define fondo, cola, entrada suave y respeta reduced-motion; «Clásico» no escribe nada", () => {
    expect(css).toContain('[data-chat="whatsapp"] .thread-bg');
    expect(css).toContain(".bubble.bubble-first::before");
    expect(css).toContain("@keyframes bubble-pop");
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*bubble-pop|bubble-pop[\s\S]*prefers-reduced-motion/);
    expect(css).not.toContain('[data-chat="classic"]');
  });

  it("la vista previa usa los mismos mensajes de ejemplo y la misma burbuja de la Bandeja", () => {
    const html = renderToStaticMarkup(
      createElement(AppearanceClient, { org: DEFAULT_APPEARANCE, personal: { font: null, chatStyle: null }, canManageOrg: false })
    );
    expect(html).toContain('data-testid="chat-preview"');
    expect((html.match(/bubble-in|bubble-out/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
