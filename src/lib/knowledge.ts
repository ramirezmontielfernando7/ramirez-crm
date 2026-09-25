/**
 * 024 — Conocimientos: contratos compartidos por la API y la UI.
 */

export type KnowledgeFileDto = {
  name: string;
  mime: string;
  size: number;
  /** Descarga/previsualización autenticada. */
  url: string;
  /** "image" se previsualiza; lo demás se enseña como documento. */
  kind: "image" | "audio" | "video" | "document";
};

export type KnowledgeEntryDto = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  file: KnowledgeFileDto | null;
  createdAt: string;
  updatedAt: string;
};

export const KNOWLEDGE_TITLE_MAX = 200;
/** Lo que cabe en un mensaje de WhatsApp (4096) — el cuerpo se envía tal cual. */
export const KNOWLEDGE_BODY_MAX = 4096;
export const KNOWLEDGE_TAGS_MAX = 10;
export const KNOWLEDGE_TAG_MAX = 40;
/** Tope de la subida; además vale el límite de WhatsApp de cada tipo (media.ts). */
export const KNOWLEDGE_FILE_MAX_BYTES = 100 * 1024 * 1024;

/** Qué archivos se aceptan en el selector (PDF, imágenes, Word, texto). */
export const KNOWLEDGE_ACCEPT = [
  "application/pdf",
  "image/*",
  ".doc",
  ".docx",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  ".txt",
].join(",");

/** "Precios, Envíos ,precios" → ["Precios", "Envíos"] (sin vacíos ni repetidos). */
export function parseTags(raw: string | string[]): string[] {
  const list = Array.isArray(raw) ? raw : raw.split(",");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of list) {
    const tag = t.trim().replace(/\s+/g, " ").slice(0, KNOWLEDGE_TAG_MAX);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out.slice(0, KNOWLEDGE_TAGS_MAX);
}
