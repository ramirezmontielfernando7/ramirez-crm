import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CHAT_STYLES,
  chatStyleLabel,
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
  it("ofrece Inter, Geist, Plus Jakarta Sans, DM Sans y Sistema", () => {
    expect(FONT_KEYS.map((k) => FONT_LABELS[k])).toEqual(["Inter", "Geist", "Plus Jakarta Sans", "DM Sans", "Sistema"]);
  });

  it("cada letra distinta de Inter tiene su regla [data-font] y su paquete local", () => {
    for (const k of FONT_KEYS.filter((k) => k !== "inter" && k !== "system")) {
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

  it("«Sistema» usa la letra nativa del dispositivo, no descarga nada y se guarda como las demás", () => {
    expect(css).toMatch(/\[data-font="system"\]\s*\{\s*--font-ui: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;/);
    expect(layout).not.toContain("fontsource-variable/system");
    expect(normalizeOrgAppearance({ font: "system" }).font).toBe("system");
    expect(readPersonalAppearance({ font: "system" }).font).toBe("system");
    // La personal gana sobre la de la organización (también «Sistema»).
    const org = { font: "geist", chatStyle: "whatsapp" } as const;
    expect(resolveAppearance(org, readPersonalAppearance({ font: "system", chatStyle: "premium" }))).toEqual({ font: "system", chatStyle: "premium" });
    expect(resolveAppearance({ font: "system", chatStyle: "premium" }, readPersonalAppearance({}))).toEqual({ font: "system", chatStyle: "premium" });
  });

  it("la pantalla muestra las cinco letras, el aviso del navegador y el nivel de organización solo a quien administra", () => {
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

  it("hay tres estilos y «Clásico» es el de fábrica", () => {
    expect([...CHAT_STYLES]).toEqual(["classic", "whatsapp", "premium"]);
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

  it("«Clásico» pinta la burbuja exactamente igual que antes de D2 (mismas clases visuales, mismos elementos)", () => {
    const antes =
      "bubble max-w-[85%] rounded-[14px] border px-3 pb-1.5 pt-2 text-[13.5px] leading-[1.45] shadow-sm bubble-out bubble-first sm:max-w-[64%] border-bubble-out-border bg-bubble-out text-bubble-out-text rounded-tr-[5px]";
    const html = renderToStaticMarkup(createElement(MessageBubble, { m: dto("out"), grouped: false }));
    expect(html).toContain(`class="${antes}"`);
    // Lo único nuevo son ganchos de estilo (clases) y un contenedor en línea del check.
    expect(html).toMatch(/<span class="tick inline-flex tick-read text-\[#53bdeb\]"><svg/);
    expect(html).toMatch(/<span class="bubble-time font-mono text-\[10px\] tracking-\[0\.04em\] text-text-3">/);
  });

  it("los estilos nuevos solo se activan con su atributo: «Clásico» no escribe reglas y nada se anima en el historial", () => {
    // Toda regla nueva cuelga de [data-chat="whatsapp"|"premium"], nunca de las clases a secas.
    const sueltas = css.match(/^\.(bubble|tick|day-pill|msg-first|msg-grouped)[^{]*\{/gm) ?? [];
    expect(sueltas).toEqual([]);
    // Sin la vieja regla que animaba siempre los dos últimos: ahora solo `.bubble-enter` (mensajes en vivo).
    expect(css).not.toContain("nth-last-child");
    expect(css).toContain('[data-chat="premium"] .bubble-enter .bubble');
  });

  it("«WhatsApp» agrupa los colores medidos como variables, en claro y en oscuro", () => {
    const claro = { "--wa-bg": "#efeae2", "--wa-out": "#d9fdd3", "--wa-in": "#ffffff", "--wa-pill": "#ffffff", "--wa-composer": "#ffffff", "--wa-header": "#ffffff", "--wa-list": "#ffffff" };
    const oscuro = { "--wa-bg": "#161717", "--wa-out": "#144d37", "--wa-in": "#242626", "--wa-pill": "#1d1f1f", "--wa-composer": "#242626", "--wa-header": "#161717", "--wa-list": "#161717" };
    const bloque = (sel: string) => css.slice(css.indexOf(sel), css.indexOf("}", css.indexOf(sel)));
    const c = bloque('[data-chat="whatsapp"] {');
    const o = bloque('[data-theme="dark"] [data-chat="whatsapp"],');
    for (const [k, v] of Object.entries(claro)) expect(c).toMatch(new RegExp(`${k}:\\s*${v}`));
    for (const [k, v] of Object.entries(oscuro)) expect(o).toMatch(new RegExp(`${k}:\\s*${v}`));
    expect((css.match(/medido de WhatsApp Web, ajustable/g) ?? []).length).toBe(2);
    // Nada de activos de WhatsApp: ni URL de imagen de fondo.
    expect(bloque('[data-chat="whatsapp"] .thread-bg')).not.toContain("url(");
  });

  it("«WhatsApp»: el texto y la hora cumplen contraste AA sobre las burbujas, en claro y en oscuro", () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x! + 0.05) / (y! + 0.05);
    };
    const claro = { text: "#111b21", time: "#54656f", pill: "#54656f", out: "#d9fdd3", inn: "#ffffff", pillBg: "#ffffff" };
    const oscuro = { text: "#e9edef", time: "#b7c4cb", pill: "#aebac1", out: "#144d37", inn: "#242626", pillBg: "#1d1f1f" };
    for (const t of [claro, oscuro]) {
      for (const bg of [t.out, t.inn]) {
        expect(ratio(t.text, bg)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t.time, bg)).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(t.pill, t.pillBg)).toBeGreaterThanOrEqual(4.5);
    }
    // Los valores de la prueba son los que de verdad están en el CSS.
    for (const v of [claro.time, oscuro.time, oscuro.pill, claro.text, oscuro.text]) expect(css).toContain(v);
  });

  it("«Premium»: tres estilos con su nombre de marca, hora al pasar el cursor, resortes y reducir-movimiento", () => {
    expect(chatStyleLabel("premium", "Dashfort")).toBe("Dashfort Premium");
    expect(chatStyleLabel("premium", "Acme")).toBe("Acme Premium");
    expect(chatStyleLabel("premium", null)).toBe("Premium");
    expect(chatStyleLabel("classic", "Acme")).toBe("Clásico");
    expect(css).toContain('[data-chat="premium"] .bubble:hover .bubble-time');
    expect(css).toMatch(/@media \(hover: none\)[\s\S]*\.bubble-time/);
    expect(css).toContain("cubic-bezier(0.34, 1.56, 0.64, 1)");
    const rm = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce) {\n  [data-chat"));
    for (const sel of ['[data-chat="premium"] .bubble-enter .bubble', '[data-chat="premium"] .typing-dot', '[data-chat="whatsapp"] .bubble-enter .bubble']) {
      expect(rm).toContain(sel);
    }
    // Premium parte del color de marca de la organización, no de un color fijo.
    expect(css).toMatch(/--pm-out-a: var\(--accent-tint\)/);
  });

  it("los checks solo dibujan estados reales del sistema", () => {
    for (const status of ["pending", "sent", "delivered", "read", "failed"] as const) {
      const html = renderToStaticMarkup(createElement(MessageBubble, { m: { ...dto("out"), status }, grouped: true }));
      expect(html).toContain(`tick-${status}`);
    }
    const entrante = renderToStaticMarkup(createElement(MessageBubble, { m: dto("in"), grouped: true }));
    expect(entrante).not.toContain("tick");
  });

  it("Apariencia muestra los tres estilos como tarjetas con mensajes de ejemplo, separador de día y probar en claro/oscuro", () => {
    const html = renderToStaticMarkup(
      createElement(AppearanceClient, { org: DEFAULT_APPEARANCE, personal: { font: null, chatStyle: null }, canManageOrg: false, brandName: "Dashfort" })
    );
    for (const nombre of ["Clásico", "WhatsApp", "Dashfort Premium"]) expect(html).toContain(`aria-label="${nombre}"`);
    expect(html.match(/data-chat="(classic|whatsapp|premium)"/g)).toHaveLength(3);
    expect((html.match(/day-pill/g) ?? []).length).toBe(3);
    expect(html).toContain('aria-label="Escribiendo…"');
    expect(html).toContain("Oscuro");
  });

  it("la vista previa usa los mismos mensajes de ejemplo y la misma burbuja de la Bandeja", () => {
    const html = renderToStaticMarkup(
      createElement(AppearanceClient, { org: DEFAULT_APPEARANCE, personal: { font: null, chatStyle: null }, canManageOrg: false })
    );
    expect(html).toContain('data-testid="chat-preview"');
    expect((html.match(/bubble-in|bubble-out/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
