/**
 * 035 — Reglas PURAS de los documentos del agente (sin BD ni red): qué
 * formatos entran, cómo se decodifica y fragmenta el texto, cómo se arma la
 * consulta por texto, el coseno, la fusión de resultados y el saneado antes
 * de ponerlos en el prompt. Las usa `src/server/kb-docs/` y la pantalla.
 */

export type KbDocMime = "text/plain" | "text/markdown" | "application/pdf";

/** Extensiones que entran. Todo lo demás se rechaza con `unsupported`. */
export const KB_DOC_EXTENSIONS: Record<string, KbDocMime> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  pdf: "application/pdf",
};

export const KB_DOC_ACCEPT = ".txt,.md,.markdown,.pdf";

/** Texto máximo de un documento ya extraído. */
export const KB_DOC_MAX_CHARS = 300_000;
/** Tamaño objetivo y solape de un fragmento (caracteres). */
export const CHUNK_SIZE = 800;
export const CHUNK_OVERLAP = 120;
/** Tope duro de un fragmento (CHECK de la 0040). */
export const CHUNK_MAX = 2000;
/** Lo que entra al prompt en un turno. */
export const MAX_INJECT_CHUNKS = 4;
export const MAX_INJECT_CHARS = 4000;
/** La consulta: los últimos mensajes del cliente, hasta este largo. */
export const QUERY_MAX_CHARS = 500;
/** Candidatos de cada búsqueda antes de fusionar. */
export const CANDIDATES = 8;

export type KbDocErrorCode =
  | "unsupported"
  | "too_large"
  | "too_long"
  | "empty"
  | "no_text"
  | "encrypted"
  | "unreadable"
  | "duplicate"
  | "document_limit"
  | "chunk_limit"
  | "internal";

/** El motivo en palabras del dueño (pantalla y respuestas de la API). */
export const KB_DOC_ERROR_LABEL: Record<KbDocErrorCode, string> = {
  unsupported: "Ese tipo de archivo no se puede usar. Sube un .txt, .md o .pdf con texto.",
  too_large: "El archivo es demasiado grande.",
  too_long: `El documento tiene demasiado texto (máximo ${KB_DOC_MAX_CHARS.toLocaleString("es-MX")} caracteres). Divídelo en partes.`,
  empty: "El archivo está vacío.",
  no_text: "Este PDF no tiene texto que se pueda leer (parece escaneado). Súbelo como .txt o un PDF con texto.",
  encrypted: "Este PDF está protegido con contraseña. Quítale la protección y vuelve a subirlo.",
  unreadable: "No se pudo leer el archivo. Revisa que no esté dañado.",
  duplicate: "Ese documento ya está subido.",
  document_limit: "Llegaste al máximo de documentos de tu negocio. Elimina alguno para subir otro.",
  chunk_limit: "Este documento no cabe: tu negocio llegó al máximo de fragmentos. Elimina documentos o súbelo más corto.",
  internal: "Algo salió mal al procesar el documento. Inténtalo de nuevo.",
};

/** Formato por extensión (y firma `%PDF-` para el PDF). */
export function detectFormat(filename: string, head: Uint8Array): { ok: true; mime: KbDocMime } | { ok: false } {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  const mime = KB_DOC_EXTENSIONS[ext];
  if (!mime) return { ok: false };
  const isPdf = head.length >= 5 && String.fromCharCode(...head.subarray(0, 5)) === "%PDF-";
  if (mime === "application/pdf" ? !isPdf : isPdf) return { ok: false };
  return { ok: true, mime };
}

/** El título por defecto: el nombre sin extensión, limpio. */
export function titleFromFilename(filename: string): string {
  const base = filename.replace(/\\/g, "/").split("/").pop() ?? filename;
  const t = base.replace(/\.[a-z0-9]+$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (t || "Documento").slice(0, 200);
}

/**
 * Bytes de un .txt/.md → texto. UTF-8 (con o sin BOM); si no es UTF-8
 * válido, Windows-1252 (lo que guarda el Bloc de notas viejo). `null` si
 * parece binario.
 */
export function decodeText(bytes: Uint8Array): string | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  if (text.includes("\u0000")) return null;
  return text.replace(/^﻿/, "");
}

/** Saltos de línea uniformes, sin caracteres de control, sin blancos de sobra. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLong(piece: string, size: number): string[] {
  if (piece.length <= size) return [piece];
  const sentences = piece.split(/(?<=[.!?…;:])\s+/);
  const out: string[] = [];
  let cur = "";
  const push = (s: string) => {
    if (s.length <= size) {
      if (cur && cur.length + 1 + s.length > size) {
        out.push(cur);
        cur = "";
      }
      cur = cur ? `${cur} ${s}` : s;
      return;
    }
    // Una "oración" enorme (una tabla pegada, una lista sin puntos): por palabras.
    for (const w of s.split(/\s+/)) {
      if (w.length > size) {
        if (cur) out.push(cur);
        cur = "";
        for (let i = 0; i < w.length; i += size) out.push(w.slice(i, i + size));
        continue;
      }
      if (cur && cur.length + 1 + w.length > size) {
        out.push(cur);
        cur = "";
      }
      cur = cur ? `${cur} ${w}` : w;
    }
  };
  for (const s of sentences) push(s);
  if (cur) out.push(cur);
  return out;
}

/** El final de un fragmento para arrancar el siguiente, cortado en palabra. */
function tail(text: string, overlap: number): string {
  if (overlap <= 0 || text.length <= overlap) return "";
  const t = text.slice(-overlap);
  const space = t.indexOf(" ");
  return space === -1 ? t : t.slice(space + 1);
}

/**
 * Divide el texto en fragmentos de ~`size` caracteres, respetando párrafos y
 * oraciones, con `overlap` caracteres del anterior al inicio de cada uno. Un
 * encabezado de markdown (`# …`) abre sección: el fragmento lleva el título
 * de su sección al principio (ayuda a encontrarlo). Ninguno pasa de
 * `CHUNK_MAX`.
 */
export function chunkText(raw: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const text = normalizeText(raw);
  if (!text) return [];
  const chunks: string[] = [];
  let heading = "";
  let cur = "";
  let curHeading = "";

  const flush = () => {
    const body = cur.trim();
    if (body) {
      const withHeading = curHeading && !body.startsWith(curHeading) ? `${curHeading}\n${body}` : body;
      chunks.push(withHeading.slice(0, CHUNK_MAX));
    }
    cur = "";
  };

  for (const para of text.split(/\n\s*\n/)) {
    const lines = para.split("\n");
    const h = lines[0]?.match(/^#{1,6}\s+(.+)$/);
    if (h) {
      // Sección nueva: cierra lo anterior si ya tiene cuerpo suficiente.
      if (cur.length >= size / 4) flush();
      heading = h[1]!.trim().slice(0, 200);
      lines.shift();
      if (!cur) curHeading = heading;
    }
    const body = lines.join("\n").trim();
    if (!body) continue;
    for (const piece of splitLong(body, size)) {
      if (cur && cur.length + 2 + piece.length > size) {
        const carry = tail(cur, overlap);
        flush();
        curHeading = heading;
        cur = carry ? `${carry}\n${piece}` : piece;
      } else {
        if (!cur) curHeading = heading;
        cur = cur ? `${cur}\n\n${piece}` : piece;
      }
    }
  }
  flush();
  return chunks;
}

/** Quita acentos (no la ñ): igual que la columna `tsv` de la 0040. */
export function foldAccents(s: string): string {
  return s.replace(/[ÁÉÍÓÚÜáéíóúü]/g, (c) => ({ Á: "A", É: "E", Í: "I", Ó: "O", Ú: "U", Ü: "U", á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u" })[c] ?? c);
}

/**
 * Palabras de relleno del chat que no ayudan a encontrar nada (las de
 * siempre, «que», «el», «de»…, ya las quita el diccionario español de
 * Postgres).
 */
const FILLER = new Set([
  "hola", "buen", "buena", "buenas", "bueno", "buenos", "dia", "dias", "tarde", "tardes", "noche", "noches",
  "gracias", "favor", "porfa", "quiero", "quisiera", "saber", "pregunta", "duda", "oye", "oiga", "disculpe",
  "disculpa", "ayuda", "ayudar", "info", "informacion", "puede", "pueden", "podria", "podrian", "tienen",
]);

/**
 * La consulta por texto para `to_tsquery('spanish', …)`: palabras sueltas
 * unidas con `|` (basta que aparezca una; `ts_rank_cd` premia a los que
 * tienen más). Solo letras y dígitos: nada de la sintaxis de tsquery llega
 * del cliente. `null` si no queda nada que buscar.
 */
export function lexicalQuery(text: string, maxTerms = 16): string | null {
  const words = foldAccents(text.toLowerCase()).match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms: string[] = [];
  for (const w of words) {
    if (w.length < 3 && !/^\d{2,}$/.test(w)) continue;
    if (FILLER.has(w) || terms.includes(w)) continue;
    terms.push(w);
    if (terms.length >= maxTerms) break;
  }
  return terms.length > 0 ? terms.join(" | ") : null;
}

/** La consulta del turno: los últimos mensajes del cliente (el más reciente al final). */
export function queryFromHistory(history: { role: "user" | "assistant"; content: string }[], maxMessages = 2): string {
  const mine = history.filter((m) => m.role === "user").slice(-maxMessages).map((m) => m.content.trim());
  const q = mine.join("\n").trim();
  return q.length > QUERY_MAX_CHARS ? q.slice(-QUERY_MAX_CHARS) : q;
}

/** Producto punto (los vectores llegan normalizados). */
export function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

/**
 * Reciprocal Rank Fusion: junta dos listas ordenadas (mejor primero) sin
 * tener que comparar sus puntajes, que no tienen la misma escala.
 */
export function fuseRrf(lists: string[][], k = 60): string[] {
  const score = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** Toma fragmentos en orden hasta `maxChunks` y `maxChars` (al menos uno). */
export function takeWithinBudget<T extends { content: string }>(
  items: T[],
  maxChunks = MAX_INJECT_CHUNKS,
  maxChars = MAX_INJECT_CHARS
): T[] {
  const out: T[] = [];
  let chars = 0;
  for (const it of items) {
    if (out.length >= maxChunks) break;
    if (out.length > 0 && chars + it.content.length > maxChars) break;
    out.push(it);
    chars += it.content.length;
  }
  return out;
}

/**
 * Texto de un documento listo para el prompt: sin nada que imite los
 * marcadores de la sección (`<<` / `>>`), sin caracteres invisibles de
 * control. El `nonce` aleatorio del turno hace imposible falsificar el cierre
 * aun así; esto es la segunda capa.
 */
export function sanitizeForPrompt(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/<{2,}/g, "‹")
    .replace(/>{2,}/g, "›");
}

/** Estado del documento en palabras (la pantalla). */
export function statusLabel(d: { status: string; embeddingModel: string | null }, embeddingsOn: boolean): string {
  switch (d.status) {
    case "pending":
      return "En cola";
    case "processing":
      return "Indexando…";
    case "ready":
      return embeddingsOn && !d.embeddingModel ? "Listo (solo texto)" : "Listo";
    default:
      return "Falló";
  }
}

/* ------------------------------------------------------------------
 * 037 — Grupos de documentos
 * ---------------------------------------------------------------- */

/**
 * «General» no es una fila: es `group_id IS NULL`. En la URL y en las
 * selecciones se escribe con esta clave.
 */
export const GENERAL_GROUP_KEY = "general";
export const GENERAL_GROUP_NAME = "General";
/** Grupos por organización (General no cuenta). */
export const MAX_DOC_GROUPS = 20;
/** Largo de un nombre de grupo (CHECK de la 0043). */
export const GROUP_NAME_MAX = 40;

export type KbGroupErrorCode = "group_name_invalid" | "group_name_reserved" | "group_name_taken" | "group_limit" | "group_not_found";

export const KB_GROUP_ERROR_LABEL: Record<KbGroupErrorCode, string> = {
  group_name_invalid: `El nombre del grupo debe tener entre 1 y ${GROUP_NAME_MAX} caracteres.`,
  group_name_reserved: "«General» ya existe y no se puede repetir. Elige otro nombre.",
  group_name_taken: "Ya tienes un grupo con ese nombre.",
  group_limit: `Llegaste al máximo de ${MAX_DOC_GROUPS} grupos. Elimina alguno para crear otro.`,
  group_not_found: "Ese grupo ya no existe.",
};

/** El nombre de un grupo, limpio, o por qué no sirve. */
export function normalizeGroupName(raw: unknown): { ok: true; name: string } | { ok: false; code: KbGroupErrorCode } {
  if (typeof raw !== "string") return { ok: false, code: "group_name_invalid" };
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > GROUP_NAME_MAX) return { ok: false, code: "group_name_invalid" };
  if (foldAccents(name).toLowerCase() === GENERAL_GROUP_KEY) return { ok: false, code: "group_name_reserved" };
  return { ok: true, name };
}

/** `group_id` → clave de la pestaña (`general` o el id). */
export function groupKey(groupId: string | null): string {
  return groupId ?? GENERAL_GROUP_KEY;
}

/** Clave de la pestaña → `group_id` (`null` = General). */
export function groupIdFromKey(key: string): string | null {
  return key === GENERAL_GROUP_KEY ? null : key;
}
