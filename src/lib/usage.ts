/**
 * 036 (PR 2) — Almacenamiento de una organización: contrato y reglas puras
 * (sin servidor ni React). Lo mide `src/server/usage/storage.ts`; lo pintan
 * /platform (PR 4) y «Uso y plan» del Propietario (PR 6).
 *
 * Es una APROXIMACIÓN honesta, no un `du` del disco:
 * - Archivos: la suma del tamaño que la BD guarda de cada archivo que sí está
 *   en `MEDIA_DIR` (multimedia de WhatsApp, Conocimientos, chat de equipo).
 *   Un archivo sin tamaño registrado se cuenta aparte (`filesWithoutSize`).
 * - Documentos del agente: el archivo original NO se guarda; ocupan su texto
 *   extraído + el texto de sus fragmentos + 4 bytes por número de cada vector.
 * - Fuera de la cuenta: los mensajes, contactos y bitácoras en Postgres, el
 *   logo y el ícono (pocos KB), los archivos huérfanos en disco y la
 *   multimedia que aún no se descargó (o falló).
 */

export const STORAGE_LABEL = "Almacenamiento (aprox.)";

export const STORAGE_NOTE =
  "Incluye los archivos de WhatsApp, de Conocimientos y del chat de equipo, y los documentos del agente (su texto y sus vectores). No incluye los mensajes ni los contactos guardados en la base de datos.";

export const STORAGE_CATEGORIES = ["whatsapp", "knowledge", "teamChat", "documents"] as const;
export type StorageCategory = (typeof STORAGE_CATEGORIES)[number];

export const STORAGE_CATEGORY_LABEL: Record<StorageCategory, string> = {
  whatsapp: "Multimedia de WhatsApp",
  knowledge: "Archivos de Conocimientos",
  teamChat: "Adjuntos del chat de equipo",
  documents: "Documentos del agente",
};

export type StorageUsage = {
  /** Bytes totales (aprox.): la suma de las categorías. */
  totalBytes: number;
  byCategory: Record<StorageCategory, number>;
  /** Archivos guardados en disco sin tamaño registrado en la BD (no suman). */
  filesWithoutSize: number;
};

/** Bytes por número de un vector de embeddings (`real` = float4). */
export const EMBEDDING_VALUE_BYTES = 4;

/** Lo que ocupan los documentos del agente, con la fórmula de arriba. */
export function documentsBytes(parts: { textBytes: number; chunkTextBytes: number; embeddingValues: number }): number {
  return toBytes(parts.textBytes) + toBytes(parts.chunkTextBytes) + toBytes(parts.embeddingValues) * EMBEDDING_VALUE_BYTES;
}

export function emptyStorageUsage(): StorageUsage {
  return { totalBytes: 0, byCategory: { whatsapp: 0, knowledge: 0, teamChat: 0, documents: 0 }, filesWithoutSize: 0 };
}

/** Arma el resultado a partir de las partes (las sumas de Postgres llegan como texto). */
export function buildStorageUsage(parts: {
  whatsapp?: unknown;
  knowledge?: unknown;
  teamChat?: unknown;
  documents?: { textBytes?: unknown; chunkTextBytes?: unknown; embeddingValues?: unknown };
  filesWithoutSize?: unknown;
}): StorageUsage {
  const byCategory: StorageUsage["byCategory"] = {
    whatsapp: toBytes(parts.whatsapp),
    knowledge: toBytes(parts.knowledge),
    teamChat: toBytes(parts.teamChat),
    documents: documentsBytes({
      textBytes: toBytes(parts.documents?.textBytes),
      chunkTextBytes: toBytes(parts.documents?.chunkTextBytes),
      embeddingValues: toBytes(parts.documents?.embeddingValues),
    }),
  };
  const totalBytes = STORAGE_CATEGORIES.reduce((s, c) => s + byCategory[c], 0);
  return { totalBytes, byCategory, filesWithoutSize: toBytes(parts.filesWithoutSize) };
}

/** Un número no negativo y entero a partir de lo que devuelva la BD (null, texto, bigint). */
export function toBytes(v: unknown): number {
  const n = typeof v === "bigint" ? Number(v) : typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** «0 B», «512 KB», «3.4 MB», «1.2 GB» (base 1024, un decimal desde MB). */
export function formatStorage(bytes: number): string {
  const b = toBytes(bytes);
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 ** 3) return `${Math.round((b / 1024 ** 2) * 10) / 10} MB`;
  return `${Math.round((b / 1024 ** 3) * 10) / 10} GB`;
}
