/**
 * 044 — Topes de subida de archivos: UNA fuente para el navegador y el
 * servidor, así el aviso que ve la persona antes de subir es el mismo que
 * daría el servidor después. Puro (sin Node): lo importan los componentes.
 *
 * - Bandeja (WhatsApp): los de la Cloud API por tipo; documentos hasta 100 MB.
 * - Biblioteca: 100 MB, y además lo de WhatsApp (lo que se guarda se puede mandar).
 * - Chat de equipo: 50 MB (interno, no sale a Meta).
 * - Documentos del agente: los de la organización (`kb_document_limit` o
 *   `KB_DOCS_MAX_FILE_MB`), nunca más de `RAG_EXTRACT_MAX_BYTES`.
 */

export const MB = 1024 * 1024;

/** Lo que el multipart agrega al archivo (límites, nombres, campos de texto). */
export const UPLOAD_ENVELOPE_BYTES = 64 * 1024;

/** Límites de la Cloud API de WhatsApp por tipo de mensaje. */
export const WA_MEDIA_RULES = {
  image: { maxBytes: 5 * MB, mimes: /^image\/(jpeg|png|webp)$/ },
  sticker: { maxBytes: 100 * 1024, mimes: /^image\/webp$/ },
  audio: { maxBytes: 16 * MB, mimes: /^audio\/(aac|mp4|mpeg|amr|ogg|opus)/ },
  video: { maxBytes: 16 * MB, mimes: /^video\/(mp4|3gpp)$/ },
  document: { maxBytes: 100 * MB, mimes: /^[\w.-]+\/[\w.+-]+$/ },
} as const;

/** El mayor que acepta la Bandeja: un documento de WhatsApp. */
export const CHAT_MEDIA_MAX_BYTES = WA_MEDIA_RULES.document.maxBytes;
/** Tope de la Biblioteca (Conocimientos). */
export const LIBRARY_FILE_MAX_BYTES = 100 * MB;
/** Tope de un adjunto del chat de equipo. */
export const TEAM_ATTACHMENT_MAX_BYTES = 50 * MB;
/**
 * Lo más grande que se abre para sacarle el texto (PDF en memoria): ni
 * Plataforma ni el entorno pueden pasarlo (`KB_DOCS_MAX_FILE_MB` ≤ 50).
 */
export const RAG_EXTRACT_MAX_BYTES = 50 * MB;

/**
 * Subidas «pesadas» (> 10 MB) a la vez en el servidor. Cada una ocupa varias
 * veces su tamaño en memoria mientras se lee y se reenvía; con 3 de 100 MB
 * el proceso sigue holgado.
 */
export const HEAVY_UPLOAD_BYTES = 10 * MB;
export const MAX_HEAVY_UPLOADS = 3;

export type OutgoingKind = "image" | "audio" | "video" | "document";

/** «4.3 MB», «850 KB»: para los mensajes. */
export function formatSize(bytes: number): string {
  if (bytes >= MB) {
    const mb = bytes / MB;
    return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** «El archivo pesa 120 MB y el máximo es 100 MB.» */
export function tooLargeMessage(size: number, maxBytes: number, what = "El archivo"): string {
  return `${what} pesa ${formatSize(size)} y el máximo es ${formatSize(maxBytes)}.`;
}

/** Nunca se aceptan: el navegador los interpretaría como documento activo. */
const BLOCKED_MIME = /^(image\/svg\+xml|text\/html|application\/xhtml\+xml|text\/xml|application\/xml)$/i;
const BLOCKED_EXT = /\.(svg|svgz|html?|xhtml|xht|xml|mht|mhtml)$/i;

/** ¿SVG o HTML (por tipo O por extensión)? */
export function isActiveContent(mime: string, fileName = ""): boolean {
  return BLOCKED_MIME.test(mime) || BLOCKED_EXT.test(fileName);
}

export const ACTIVE_CONTENT_MESSAGE = "Por seguridad no se aceptan archivos SVG ni HTML";

/** Clasifica un MIME de archivo saliente al tipo de mensaje de la Cloud API. */
export function kindFromMime(mime: string): OutgoingKind {
  if (WA_MEDIA_RULES.image.mimes.test(mime)) return "image";
  if (WA_MEDIA_RULES.audio.mimes.test(mime)) return "audio";
  if (WA_MEDIA_RULES.video.mimes.test(mime)) return "video";
  return "document";
}

/** Qué decir cuando un archivo pasa el límite de WhatsApp de su tipo. */
const WA_TOO_LARGE: Record<OutgoingKind, (size: number) => string> = {
  image: (s) =>
    `La foto pesa ${formatSize(s)} y WhatsApp solo acepta fotos de hasta 5 MB. Redúcela o mándala en PDF.`,
  audio: (s) => `El audio pesa ${formatSize(s)} y WhatsApp solo acepta audios de hasta 16 MB.`,
  video: (s) =>
    `El video pesa ${formatSize(s)} y WhatsApp solo acepta videos de hasta 16 MB. Recórtalo o comparte un enlace (Drive, YouTube).`,
  document: (s) => `El archivo pesa ${formatSize(s)} y WhatsApp solo acepta archivos de hasta 100 MB.`,
};

export type UploadProblem = { code: "too_large" | "unsupported_type"; message: string };

/**
 * ¿Se puede mandar por WhatsApp? Devuelve el tipo de mensaje o el problema,
 * con el mensaje para la persona. Los formatos que WhatsApp no acepta como su
 * tipo nativo (p. ej. image/bmp) van como documento, igual que en la app.
 */
export function checkOutgoing(
  mime: string,
  size: number,
  fileName = ""
): { ok: true; kind: OutgoingKind } | ({ ok: false } & UploadProblem) {
  if (!/^[\w.-]+\/[\w.+-]+$/.test(mime)) {
    return { ok: false, code: "unsupported_type", message: "Tipo de archivo no reconocido" };
  }
  if (isActiveContent(mime, fileName)) {
    return { ok: false, code: "unsupported_type", message: ACTIVE_CONTENT_MESSAGE };
  }
  const kind = kindFromMime(mime);
  if (size > WA_MEDIA_RULES[kind].maxBytes) {
    return { ok: false, code: "too_large", message: WA_TOO_LARGE[kind](size) };
  }
  return { ok: true, kind };
}

/** Extensiones que acepta la Biblioteca (las mismas del selector). */
const LIBRARY_EXT = /\.(pdf|docx?|txt|md|markdown|jpe?g|png|webp|gif|heic|heif)$/i;
const LIBRARY_MIME =
  /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|text\/plain|text\/markdown|text\/x-markdown|image\/(jpeg|png|webp|gif|heic|heif))$/i;

/**
 * ¿Se puede guardar en la Biblioteca? PDF, Word, texto e imágenes, hasta
 * 100 MB, y que se pueda mandar por WhatsApp. El tipo se mira por MIME y, si
 * el navegador no lo manda, por extensión.
 */
export function libraryFileProblem(mime: string, fileName: string, size: number): UploadProblem | null {
  if (isActiveContent(mime, fileName)) return { code: "unsupported_type", message: ACTIVE_CONTENT_MESSAGE };
  const typed = mime && mime !== "application/octet-stream";
  if (typed ? !LIBRARY_MIME.test(mime) : !LIBRARY_EXT.test(fileName)) {
    return { code: "unsupported_type", message: "Ese tipo de archivo no se puede guardar. Sube un PDF, Word, texto o una imagen." };
  }
  if (size > LIBRARY_FILE_MAX_BYTES) return { code: "too_large", message: tooLargeMessage(size, LIBRARY_FILE_MAX_BYTES) };
  return null;
}

/**
 * El mensaje cuando la respuesta NO trae nuestro JSON: la cortó el proxy
 * (413 de Traefik/Cloudflare) o se acabó el tiempo a medio subir.
 */
export function uploadHttpMessage(status: number): string | null {
  if (status === 413) return "El archivo es demasiado grande para el servidor.";
  if (status === 502 || status === 504 || status === 408) {
    return "La subida tardó demasiado y se cortó. Revisa tu internet o prueba con un archivo más ligero.";
  }
  if (status === 503) return "El servidor está ocupado con otras subidas. Intenta de nuevo en un minuto.";
  return null;
}
