/**
 * Cabeceras para servir un archivo que subió OTRA persona (un cliente por
 * WhatsApp, un compañero en el chat de equipo) desde el origen de la app.
 *
 * El MIME lo declara el remitente: un `text/html` o un `image/svg+xml`
 * servido tal cual se ejecutaría en el origen del CRM con la sesión de quien
 * lo abre. La política (H9, la misma del chat de equipo desde 025):
 *
 * - `X-Content-Type-Options: nosniff` y `Content-Security-Policy: sandbox`
 *   en todo.
 * - Solo las imágenes raster (jpeg, png, webp, gif) van `inline`; todo lo
 *   demás, `attachment` (abrirlo en una pestaña lo descarga).
 * - El `Content-Type` declarado solo se respeta para lo que el navegador no
 *   ejecuta: imágenes raster, audio, video y PDF. Lo demás (HTML, SVG, XML,
 *   JS…) sale como `application/octet-stream`.
 *
 * `<img>`, `<audio>` y `<video>` ignoran `Content-Disposition`, así que la
 * vista previa de la Bandeja no cambia.
 */

/** Imágenes que el navegador solo puede pintar (sin scripts): se ven inline. */
export function isInlineImage(mime: string): boolean {
  return /^image\/(jpeg|png|webp|gif)$/i.test(mime);
}

/** Tipos que conservan su MIME (el navegador no los ejecuta como documento). */
function isPassiveType(baseType: string): boolean {
  return (
    isInlineImage(baseType) ||
    /^audio\/[\w.+-]+$/i.test(baseType) ||
    /^video\/[\w.+-]+$/i.test(baseType) ||
    baseType.toLowerCase() === "application/pdf"
  );
}

/** `audio/ogg; codecs=opus` → se conserva solo si no trae nada raro. */
const SAFE_MIME = /^[\w.+-]+\/[\w.+-]+(\s*;\s*[\w.+-]+=[\w.+-]+)*$/;

export function safeAttachmentHeaders(input: {
  mimeType: string | null;
  fileName: string | null;
  byteLength: number;
}): Record<string, string> {
  const declared = (input.mimeType ?? "").trim();
  const baseType = declared.split(";")[0]?.trim() ?? "";
  const passive = isPassiveType(baseType);
  const contentType = passive
    ? SAFE_MIME.test(declared)
      ? declared
      : baseType
    : "application/octet-stream";
  const inline = isInlineImage(baseType);
  const safeName = input.fileName?.replace(/[^\w. ()-]/g, "_");
  return {
    "content-type": contentType,
    "content-length": String(input.byteLength),
    "content-disposition": `${inline ? "inline" : "attachment"}${safeName ? `; filename="${safeName}"` : ""}`,
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox",
  };
}
