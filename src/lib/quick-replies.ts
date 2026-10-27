import { z } from "zod";
import { normalizeText } from "@/lib/search";

/**
 * Respuestas rápidas — reglas puras que comparten Ajustes, el compositor y
 * la API: cómo se escribe un atajo, cómo se filtra con `/` y cómo se llena
 * `{nombre}` al insertarla.
 */
export type QuickReplyDto = { id: string; shortcut: string; body: string };

export const SHORTCUT_MAX = 30;
export const BODY_MAX = 4096;
export const SHORTCUT_RE = /^[a-z0-9_-]{1,30}$/;

/** Lo que aceptan `POST /api/quick-replies` y su `PATCH` (parcial). */
export const quickReplySchema = z.object({
  shortcut: z.string().trim().regex(SHORTCUT_RE, "El atajo va en minúsculas, sin espacios ni acentos (hasta 30)"),
  body: z.string().trim().min(1).max(BODY_MAX),
});

/** «Precios 2026» → «precios-2026»: minúsculas, sin acentos ni espacios. */
export function normalizeShortcut(raw: string): string {
  return normalizeText(raw.trim().replace(/^\/+/, ""))
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, SHORTCUT_MAX);
}

/**
 * Lo que se escribió después de `/` en el editor, o null si el editor no es
 * un comando (no empieza con `/` o ya tiene un espacio o salto de línea).
 */
export function slashQuery(text: string): string | null {
  const m = /^\/([^\s]*)$/.exec(text);
  return m ? normalizeText(m[1]!) : null;
}

/** Primero las que EMPIEZAN con lo escrito; después las que lo contienen (atajo o texto). */
export function filterQuickReplies(list: readonly QuickReplyDto[], query: string): QuickReplyDto[] {
  const q = normalizeText(query.trim());
  if (!q) return [...list];
  const starts = list.filter((r) => r.shortcut.startsWith(q));
  const rest = list.filter((r) => !r.shortcut.startsWith(q) && (r.shortcut.includes(q) || normalizeText(r.body).includes(q)));
  return [...starts, ...rest];
}

/** `{nombre}` → el primer nombre del contacto (vacío si no hay). */
export function fillQuickReply(body: string, contactName: string | null | undefined): string {
  const first = (contactName ?? "").trim().split(/\s+/)[0] ?? "";
  // Un nombre que es un teléfono no es un nombre.
  const name = /\d{5,}/.test(first) ? "" : first;
  // Sin nombre se quita también el espacio de antes: «Hola {nombre}, …» → «Hola, …».
  return name ? body.replace(/\{\s*nombre\s*\}/gi, name) : body.replace(/ ?\{\s*nombre\s*\}/gi, "");
}
