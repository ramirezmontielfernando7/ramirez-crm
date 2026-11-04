/**
 * Largo de los mensajes de texto (reglas puras, navegador y servidor).
 *
 * - WhatsApp por Meta (API oficial de Cloud): un texto admite 4,096
 *   caracteres. Uno más largo se DIVIDE en varios mensajes seguidos
 *   (`splitForMeta`), en orden, cortando en saltos de línea o frases.
 * - Conexión directa y «Mi número» (dispositivo vinculado): el límite es el
 *   de la app de WhatsApp, 65,536 caracteres, en un solo mensaje.
 * - Lo que escribe una persona en la Bandeja o en «Mi número» se acepta hasta
 *   `CHAT_TEXT_MAX`; la vía decide después si sale entero o en partes.
 */

/** Lo que acepta Meta en un mensaje de texto. */
export const META_TEXT_MAX = 4096;

/** Lo que acepta la app de WhatsApp (dispositivo vinculado) en un mensaje. */
export const DIRECT_TEXT_MAX = 65536;

/** Lo más largo que una persona puede escribir en un chat de cliente. */
export const CHAT_TEXT_MAX = DIRECT_TEXT_MAX;

/** Mensaje de error de las rutas de envío. */
export const CHAT_TEXT_TOO_LONG = `Escribe un mensaje (hasta ${CHAT_TEXT_MAX.toLocaleString("en-US")} caracteres).`;

/** Separadores preferidos, del mejor corte al peor. */
const BREAKS: RegExp[] = [/\n\s*\n/g, /\n/g, /[.!?…]["')\]»]?\s+/g, /[;:,]\s+/g, /\s+/g];

/**
 * Divide un texto en partes de máximo `max` caracteres (unidades UTF-16,
 * que nunca son menos que los caracteres que cuenta Meta). Corta en el
 * último párrafo, salto de línea, fin de frase, coma o espacio que quepa; si
 * no hay ninguno, corta en seco sin partir un emoji. Ninguna parte queda
 * vacía y, unidas, conservan todo el texto salvo los espacios del corte.
 */
export function splitForMeta(text: string, max: number = META_TEXT_MAX): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const cut = cutPoint(rest, max);
    const head = rest.slice(0, cut.end).trimEnd();
    if (head) parts.push(head);
    rest = rest.slice(cut.next).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

function cutPoint(text: string, max: number): { end: number; next: number } {
  const window = text.slice(0, max + 1);
  // No vale un corte en el primer cuarto: dejaría partes ridículamente cortas.
  const min = Math.floor(max / 4);
  for (const re of BREAKS) {
    let best: { end: number; next: number } | null = null;
    re.lastIndex = 0;
    for (let m = re.exec(window); m; m = re.exec(window)) {
      const sepStart = m.index;
      const sepEnd = m.index + m[0].length;
      // El signo de la frase se queda en la parte de arriba; el espacio, fuera.
      const keep = m[0].replace(/\s+$/, "").length;
      const end = sepStart + keep;
      if (end > max) break;
      if (end >= min) best = { end, next: sepEnd };
      if (m[0].length === 0) re.lastIndex++;
    }
    if (best) return best;
  }
  // Sin separador: corte en seco, sin partir un par sustituto (emoji).
  let end = max;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return { end, next: end };
}
