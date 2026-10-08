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

/* ───────── 036 (PR 4) — IA del mes y medidores de /platform ───────── */

export const AI_KINDS = ["agent", "lab", "judge", "writing", "embed"] as const;
export type AiUsageKind = (typeof AI_KINDS)[number];

export const AI_KIND_LABEL: Record<AiUsageKind, string> = {
  agent: "Agente (conversaciones reales)",
  lab: "Laboratorio y vista previa",
  judge: "Juez del Laboratorio",
  writing: "Asistente de redacción",
  embed: "Embeddings de documentos",
};

/** Los embeddings se cuentan aparte: no gastan el tope de turnos ni de tokens. */
export const EMBED_NOTE = "Aparte: no cuentan en el tope de IA.";

/** «950», «12.3 k», «1.2 M» (compacto, es-MX). */
export function formatTokens(n: number): string {
  // Intl separa con espacio duro (y no igual en todo entorno): se normaliza.
  return new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 })
    .format(toBytes(n))
    .replace(/\s/g, " ");
}

export type MeterTone = "normal" | "warning" | "danger";

/** 80 % o más avisa; 100 % o más es rojo. */
export function meterTone(ratio: number | null): MeterTone {
  if (ratio === null) return "normal";
  if (ratio >= 1) return "danger";
  if (ratio >= 0.8) return "warning";
  return "normal";
}

export type Meter = {
  /** Lo que se lee en la fila: «1.2 M / 5 M tokens» o «1.2 M tokens · sin tope». */
  text: string;
  /** Proporción usada (0…∞) o `null` sin tope. */
  ratio: number | null;
  tone: MeterTone;
  /** El detalle completo (para el título al pasar el cursor). */
  detail: string;
};

/**
 * La IA del mes contra su tope. Con dos topes (turnos y tokens) muestra el
 * que vaya más alto: es el que va a frenar primero.
 */
export function aiMeter(
  used: { turns: number; tokens: number },
  limits: { turns: number | null; tokens: number | null }
): Meter {
  const tokensRatio = limits.tokens ? used.tokens / limits.tokens : limits.tokens === 0 ? Infinity : null;
  const turnsRatio = limits.turns ? used.turns / limits.turns : limits.turns === 0 ? Infinity : null;
  const tokensLine = `${formatTokens(used.tokens)}${limits.tokens !== null ? ` / ${formatTokens(limits.tokens)}` : ""} tokens`;
  const turnsLine = `${used.turns.toLocaleString("es-MX")}${limits.turns !== null ? ` / ${limits.turns.toLocaleString("es-MX")}` : ""} turnos`;
  const detail = `${tokensLine} · ${turnsLine}${limits.tokens === null && limits.turns === null ? " · sin tope" : ""}`;
  if (tokensRatio === null && turnsRatio === null) {
    return { text: `${formatTokens(used.tokens)} tokens · sin tope`, ratio: null, tone: "normal", detail };
  }
  const porTurnos = (turnsRatio ?? -1) > (tokensRatio ?? -1);
  const ratio = porTurnos ? turnsRatio! : tokensRatio!;
  return { text: porTurnos ? turnsLine : tokensLine, ratio, tone: meterTone(ratio), detail };
}

/** El almacenamiento contra su tope (hasta el PR 3 no hay tope: «sin tope»). */
export function storageMeter(bytes: number, limitBytes: number | null = null): Meter {
  if (limitBytes === null) {
    const text = `${formatStorage(bytes)} · sin tope`;
    return { text, ratio: null, tone: "normal", detail: `${STORAGE_LABEL}: ${text}` };
  }
  const ratio = limitBytes > 0 ? bytes / limitBytes : Infinity;
  const text = `${formatStorage(bytes)} / ${formatStorage(limitBytes)}`;
  return { text, ratio, tone: meterTone(ratio), detail: `${STORAGE_LABEL}: ${text}` };
}
