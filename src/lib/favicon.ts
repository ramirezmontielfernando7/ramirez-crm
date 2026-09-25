import {
  BRAND_BUBBLE,
  BRAND_BUBBLE_STROKE,
  BRAND_TEAL,
  BRAND_TEAL_LIGHT,
  isHouseName,
} from "./brand";
import { resolveAccentSet, type Branding } from "./branding";

/**
 * El icono de la pestaña, white-label.
 *
 * Toda instancia tiene uno **sin configurar nada**: si se llama Dashfort, es
 * el logo de la marca (la burbuja blanca sobre el mosaico teal); con otro
 * nombre se dibuja la inicial sobre el acento. Una
 * agencia que despliega para su cliente puede subir el logo real y
 * reemplazarlo.
 *
 * Que exista un respaldo generado no es un adorno: sin él, quien no suba nada
 * se queda con el icono genérico del navegador, y con cinco instancias abiertas
 * en pestañas todas se ven iguales.
 */

/**
 * Nombre fijo dentro del volumen de medios: una organización tiene un solo
 * icono. Vive aquí y no en la ruta que lo sirve porque Next solo admite
 * handlers como exports de un `route.ts` — cualquier otra cosa rompe el build.
 */
export const FAVICON_ASSET = "favicon";

/** Lo que el navegador acepta como icono y nosotros sabemos verificar. */
export const FAVICON_MIMES = [
  "image/png",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/jpeg",
  "image/webp",
] as const;

export type FaviconMime = (typeof FAVICON_MIMES)[number];

/**
 * 256 KB. Un favicon de más no existe; el tope está para que nadie use este
 * campo como almacén de archivos.
 */
export const MAX_FAVICON_BYTES = 256 * 1024;

export function isFaviconMime(value: string): value is FaviconMime {
  return (FAVICON_MIMES as readonly string[]).includes(value);
}

/**
 * Qué es el archivo DE VERDAD, según sus primeros bytes.
 *
 * No se confía en el `content-type` que manda el cliente: declarar `image/png`
 * y subir un HTML es la forma clásica de colar un documento donde se espera
 * una imagen. Devuelve null si no reconoce el formato — y entonces no se
 * guarda.
 */
export function sniffFaviconMime(bytes: Uint8Array): FaviconMime | null {
  const at = (i: number) => bytes[i];

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
    at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  // ICO: 00 00 01 00
  if (at(0) === 0x00 && at(1) === 0x00 && at(2) === 0x01 && at(3) === 0x00) {
    return "image/x-icon";
  }
  // WEBP: "RIFF" .... "WEBP"
  const ascii = (i: number, s: string) =>
    [...s].every((c, k) => bytes[i + k] === c.charCodeAt(0));
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";

  // SVG: es texto. Se admite con o sin declaración XML o comentarios delante.
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.slice(0, 1024))
    .trimStart();
  if (/^<(\?xml|!--|svg)[\s>]/i.test(head) && /<svg[\s>]/i.test(head)) {
    return "image/svg+xml";
  }

  return null;
}

/** Inicial que se dibuja. Vacío o raro cae a la D de Dashfort. */
export function faviconInitial(name: string): string {
  const c = name.trim().charAt(0).toUpperCase();
  return c || "D";
}

/**
 * El icono generado. SVG y no PNG a propósito: se dibuja nítido en cualquier
 * densidad, pesa cientos de bytes y no necesita ninguna librería de imagen en
 * el servidor.
 */
export function generatedFaviconSvg(branding: Branding): string {
  const { accent, fg } = resolveAccentSet(branding.accent);
  if (isHouseName(branding.name)) return houseFaviconSvg();
  const letra = faviconInitial(branding.name)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">`,
    `<rect width="64" height="64" rx="12" fill="${accent}"/>`,
    `<text x="32" y="33" fill="${fg}" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"`,
    ` font-size="38" font-weight="700" text-anchor="middle" dominant-baseline="central">${letra}</text>`,
    `</svg>`,
  ].join("");
}

/**
 * El favicon de Dashfort: la burbuja blanca sobre el teal del logo. El teal no
 * sigue al acento: es el color de la marca, el mismo del mosaico del menú.
 */
function houseFaviconSvg(): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">`,
    `<defs><radialGradient id="g" cx="0.45" cy="0.4" r="0.7">`,
    `<stop offset="0" stop-color="${BRAND_TEAL_LIGHT}"/><stop offset="1" stop-color="${BRAND_TEAL}"/>`,
    `</radialGradient></defs>`,
    `<rect width="64" height="64" rx="14" fill="url(#g)"/>`,
    `<g transform="translate(14 14) scale(1.5)" fill="none" stroke-linecap="round" stroke-linejoin="round">`,
    `<path d="${BRAND_BUBBLE}" stroke="#ffffff" stroke-width="${BRAND_BUBBLE_STROKE}"/>`,
    `</g></svg>`,
  ].join("");
}

/**
 * Sufijo de caché del icono.
 *
 * Los navegadores guardan el favicon con una insistencia notable: sin que la
 * URL cambie, el logo nuevo puede tardar días en aparecer. Para el subido va
 * el número de versión; para el generado, un hash del nombre y el acento, que
 * son justo lo que lo cambia.
 */
export function faviconCacheKey(
  branding: Pick<Branding, "name" | "accent" | "favicon">
): string {
  if (branding.favicon) return `u${branding.favicon.version}`;
  let h = 0;
  const semilla = `${branding.name}|${branding.accent}`;
  for (let i = 0; i < semilla.length; i++) {
    h = (h * 31 + semilla.charCodeAt(i)) >>> 0;
  }
  return `g${h.toString(36)}`;
}

/** URL que va en el `<link rel="icon">`. */
export function faviconHref(
  branding: Pick<Branding, "name" | "accent" | "favicon">
): string {
  return `/api/branding/favicon?v=${faviconCacheKey(branding)}`;
}
