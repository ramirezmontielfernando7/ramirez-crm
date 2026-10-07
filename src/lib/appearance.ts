/**
 * Fase D — Personalización → Apariencia: tipografía y estilo del chat.
 *
 * Dos niveles, sin migración:
 *  · ORGANIZACIÓN: dentro de `organization.metadata.appearance` (junto a la
 *    marca). La cambia quien tiene `settings.manage`.
 *  · PERSONA: una cookie por dispositivo (como el tema). Pisa a la de la
 *    organización solo para esa persona y solo en ese navegador.
 *
 * Pura: la usan el layout raíz (servidor, para pintar sin parpadeo) y el
 * cliente. El resultado viaja como atributos `data-font` / `data-chat` en
 * <html>; los estilos viven en `globals.css`.
 */

export const FONT_KEYS = ["inter", "geist", "jakarta", "dmsans", "system"] as const;
export type FontKey = (typeof FONT_KEYS)[number];

export const FONT_LABELS: Record<FontKey, string> = {
  inter: "Inter",
  geist: "Geist",
  jakarta: "Plus Jakarta Sans",
  dmsans: "DM Sans",
  // D2: la letra nativa de cada dispositivo; no descarga nada.
  system: "Sistema",
};

export const DEFAULT_FONT: FontKey = "inter";

export const CHAT_STYLES = ["classic", "whatsapp", "premium"] as const;
export type ChatStyle = (typeof CHAT_STYLES)[number];

export const CHAT_STYLE_LABELS: Record<ChatStyle, string> = {
  classic: "Clásico",
  whatsapp: "WhatsApp",
  premium: "Premium",
};

/**
 * Nombre que se muestra del estilo. «Premium» lleva la marca de la
 * organización («Dashfort Premium», o su nombre white-label).
 */
export function chatStyleLabel(style: ChatStyle, brandName?: string | null): string {
  if (style !== "premium") return CHAT_STYLE_LABELS[style];
  const brand = brandName?.trim();
  return brand ? `${brand} Premium` : CHAT_STYLE_LABELS.premium;
}

export const DEFAULT_CHAT_STYLE: ChatStyle = "classic";

/** Cookies de la preferencia PERSONAL. Ausente = seguir a la organización. */
export const FONT_COOKIE = "vocero-font";
export const CHAT_STYLE_COOKIE = "vocero-chat-style";
export const APPEARANCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isFontKey(value: unknown): value is FontKey {
  return typeof value === "string" && (FONT_KEYS as readonly string[]).includes(value);
}

export function isChatStyle(value: unknown): value is ChatStyle {
  return typeof value === "string" && (CHAT_STYLES as readonly string[]).includes(value);
}

/** Lo guardado en la organización, ya limpio. Nunca lanza (JSON ajeno o viejo). */
export type OrgAppearance = { font: FontKey; chatStyle: ChatStyle };

export const DEFAULT_APPEARANCE: OrgAppearance = {
  font: DEFAULT_FONT,
  chatStyle: DEFAULT_CHAT_STYLE,
};

export function normalizeOrgAppearance(raw: unknown): OrgAppearance {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    font: isFontKey(r.font) ? r.font : DEFAULT_FONT,
    chatStyle: isChatStyle(r.chatStyle) ? r.chatStyle : DEFAULT_CHAT_STYLE,
  };
}

/** Lo personal: `null` = "usar la de la organización". */
export type PersonalAppearance = { font: FontKey | null; chatStyle: ChatStyle | null };

export function readPersonalAppearance(cookie: {
  font?: string | null;
  chatStyle?: string | null;
}): PersonalAppearance {
  return {
    font: isFontKey(cookie.font) ? cookie.font : null,
    chatStyle: isChatStyle(cookie.chatStyle) ? cookie.chatStyle : null,
  };
}

/** Lo que de verdad se pinta: la preferencia personal gana a la de la organización. */
export function resolveAppearance(
  org: OrgAppearance,
  personal: PersonalAppearance
): OrgAppearance {
  return {
    font: personal.font ?? org.font,
    chatStyle: personal.chatStyle ?? org.chatStyle,
  };
}

/** Escribe (o borra, con `null`) una cookie de apariencia en el navegador. */
export function writeAppearanceCookie(name: string, value: string | null): void {
  document.cookie =
    value === null
      ? `${name}=;path=/;max-age=0;samesite=lax`
      : `${name}=${value};path=/;max-age=${APPEARANCE_COOKIE_MAX_AGE};samesite=lax`;
}
