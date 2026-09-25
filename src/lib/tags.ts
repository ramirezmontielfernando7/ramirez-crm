/**
 * 021 — Etiquetas de contacto: contrato compartido cliente/servidor.
 *
 * El color es una CLAVE de esta paleta, no un hex libre: así la etiqueta se
 * ve bien en tema claro y oscuro sin que nadie elija un amarillo ilegible.
 */
export const TAG_COLORS = [
  "gris",
  "azul",
  "verde",
  "ambar",
  "rojo",
  "morado",
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

export function isTagColor(value: unknown): value is TagColor {
  return typeof value === "string" && (TAG_COLORS as readonly string[]).includes(value);
}

/** Clases de Tailwind por color (mismas familias que `Badge`). */
export const TAG_COLOR_CLASS: Record<TagColor, string> = {
  gris: "bg-muted text-muted-foreground",
  azul: "bg-brand-tint text-brand-text",
  verde: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  ambar: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  rojo: "bg-red-500/15 text-red-700 dark:text-red-300",
  morado: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
};

export function tagColorClass(color: string | null | undefined): string {
  return TAG_COLOR_CLASS[isTagColor(color) ? color : "gris"];
}

export const TAG_NAME_MAX = 60;

/** Nombre canónico: sin espacios de sobra. Vacío o muy largo → null. */
export function normalizeTagName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name || name.length > TAG_NAME_MAX) return null;
  return name;
}

export type TagDto = {
  id: string;
  name: string;
  color: TagColor | null;
  /** Cuántos contactos la llevan (solo en el listado de Ajustes). */
  contactCount?: number;
};

/* ------------------------------------------------------------------ */

/** 021 — Consentimiento para mensajes masivos de WhatsApp. */
export const WA_CONSENT_VALUES = ["opt_in", "opt_out", "desconocido"] as const;
export type WaConsent = (typeof WA_CONSENT_VALUES)[number];

export const WA_CONSENT_LABEL: Record<WaConsent, string> = {
  opt_in: "Acepta mensajes",
  opt_out: "No quiere mensajes",
  desconocido: "Sin confirmar",
};

/**
 * Lee un valor de consentimiento escrito por una persona (CSV, formulario).
 * Tolera las formas comunes ("sí", "opt-in", "baja"…). Irreconocible → null,
 * que quien llama reporta como error: adivinar un consentimiento es
 * justamente lo que no se puede hacer.
 */
export function parseWaConsent(raw: string): WaConsent | null {
  const v = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s-]+/g, "_");
  if (!v) return null;
  if (["opt_in", "optin", "si", "yes", "true", "1", "acepta", "aceptado"].includes(v)) {
    return "opt_in";
  }
  if (["opt_out", "optout", "no", "false", "0", "baja", "stop", "rechaza"].includes(v)) {
    return "opt_out";
  }
  if (["desconocido", "unknown", "sin_confirmar", "pendiente"].includes(v)) {
    return "desconocido";
  }
  return null;
}
