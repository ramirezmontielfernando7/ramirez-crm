/**
 * Campañas v2 (PR 1) — Reglas puras de la baja por palabra clave (STOP/BAJA).
 * Sin BD: las usan el servidor (ingesta, Ajustes) y las pruebas.
 *
 * La coincidencia es con el mensaje COMPLETO, no con una palabra suelta
 * dentro de él: "no me des de baja" o "quiero cancelar mi cita" no dan de
 * baja a nadie. Por eso los defaults evitan palabras que un cliente usa para
 * otra cosa ("cancelar", "alto"): cada organización puede agregarlas.
 */

/**
 * Palabras por defecto, en español e inglés. "detener promociones" y "stop
 * promotions" cubren el botón de baja de las plantillas de marketing de Meta
 * (su texto exacto NO está verificado contra la documentación oficial; ver
 * docs/campanas-v2-meta.md).
 */
export const DEFAULT_STOP_KEYWORDS: readonly string[] = [
  "baja",
  "dar de baja",
  "darme de baja",
  "detener promociones",
  "stop",
  "stop promotions",
  "unsubscribe",
];

export const MAX_STOP_KEYWORDS = 30;
export const MAX_STOP_KEYWORD_LENGTH = 40;
export const MAX_STOP_REPLY_LENGTH = 500;

/** Minúsculas, sin acentos, sin puntuación ni emojis, espacios colapsados. */
export function normalizeKeyword(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** La palabra clave con la que coincide el mensaje completo, o null. */
export function matchStopKeyword(text: string | null | undefined, keywords: readonly string[]): string | null {
  if (!text) return null;
  const normalized = normalizeKeyword(text);
  if (!normalized || normalized.length > MAX_STOP_KEYWORD_LENGTH) return null;
  for (const k of keywords) {
    if (normalizeKeyword(k) === normalized) return k;
  }
  return null;
}

/**
 * Limpia la lista que manda Ajustes: normalizada, sin vacías ni repetidas,
 * con tope de cantidad y largo. Devuelve el error en español si no sirve.
 */
export function cleanStopKeywords(input: readonly string[]): { keywords: string[] } | { error: string } {
  const out: string[] = [];
  for (const raw of input) {
    const k = normalizeKeyword(raw);
    if (!k) continue;
    if (k.length > MAX_STOP_KEYWORD_LENGTH) {
      return { error: `«${raw.slice(0, 50)}» es muy larga (máximo ${MAX_STOP_KEYWORD_LENGTH} caracteres)` };
    }
    if (!out.includes(k)) out.push(k);
  }
  if (out.length > MAX_STOP_KEYWORDS) return { error: `Máximo ${MAX_STOP_KEYWORDS} palabras de baja` };
  return { keywords: out };
}
