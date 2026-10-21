import { createHash } from "node:crypto";
import { can, type Permission } from "@/lib/auth/permissions";
import { detectFormat, KB_DOC_MAX_CHARS, normalizeText, type KbDocMime } from "@/lib/kb-docs";
import { extractDocumentText } from "@/server/kb-docs/extract";
import { orgHasKbDocs } from "@/server/kb-docs/flag";
import { scheduleIndex } from "@/server/kb-docs/indexer";
import { formatBytes, getKbDocLimits } from "@/server/kb-docs/limits";
import {
  createDocument,
  deleteDocument,
  getDocument,
  getDocumentByEntry,
  KbDocError,
  type KbDocument,
} from "@/server/kb-docs/store";
import {
  createKnowledge,
  deleteKnowledge,
  getKnowledge,
  readKnowledgeFile,
  setKnowledgeInChat,
  type KnowledgeRow,
} from "@/server/knowledge/store";
import { assertCanUpload } from "@/server/limits";
import { checkStorageAlerts } from "@/server/limits/alerts";
import { orgHasModule } from "@/server/modules";

/**
 * 040 — Biblioteca unificada: UN archivo, DOS destinos.
 *
 * - «💬 Envío en chat»: la entrada de Conocimientos (`knowledge_entry`, con
 *   el archivo en `MEDIA_DIR`) aparece en la Bandeja (`KnowledgePicker`).
 * - «🤖 Lectura IA (RAG)»: el documento del agente (`kb_document` +
 *   `kb_chunk`) con `knowledge_entry_id` apuntando a esa entrada.
 *
 * Este módulo es el PUENTE: no toca tablas, solo llama a las dos puertas
 * (`server/knowledge/store.ts` y `server/kb-docs/store.ts`), así que valen
 * igual sus límites (documentos, fragmentos, candado de la organización),
 * el `scoped()`/RLS de cada consulta y `assertCanUpload`. Quién puede mover
 * cada destino lo dice `libraryAccess` (módulo + permiso); las rutas
 * vuelven a preguntar con `withAuth`.
 *
 * Reglas:
 * - Un destino al menos: apagar el último es 422 (para quitar los dos, se
 *   borra).
 * - Apagar «Envío en chat» CONSERVA el archivo (`show_in_chat = false`):
 *   volver a encenderlo no pide subirlo otra vez.
 * - Apagar «Lectura IA» borra el documento y sus fragmentos; volver a
 *   encenderlo vuelve a extraer el texto del archivo guardado.
 * - Un documento subido antes del 040 (o sin «Envío en chat» al subirlo) no
 *   tiene el original: no se puede mandar al chat sin volver a subirlo.
 */

export type LibraryErrorCode = "no_original" | "last_destination" | "not_eligible" | "not_found";

export const LIBRARY_ERROR_LABEL: Record<LibraryErrorCode, string> = {
  no_original:
    "Este documento no guarda el archivo original (se subió solo para la IA). Vuelve a subirlo con «Disponible en Bandeja» para enviarlo en el chat.",
  last_destination:
    "Es el único destino del archivo. Para quitarlo de todos lados, elimínalo.",
  not_eligible:
    "La IA solo lee .pdf con texto, .txt o .md (o el texto de la entrada). Esta entrada no tiene nada de eso.",
  not_found: "No encontrado",
};

const LIBRARY_ERROR_STATUS: Record<LibraryErrorCode, number> = {
  no_original: 409,
  last_destination: 422,
  not_eligible: 422,
  not_found: 404,
};

export class LibraryError extends Error {
  constructor(readonly code: LibraryErrorCode) {
    super(LIBRARY_ERROR_LABEL[code]);
    this.name = "LibraryError";
  }
  get status(): number {
    return LIBRARY_ERROR_STATUS[this.code];
  }
}

type Subject = { organizationId: string; role: string; grants?: readonly Permission[] };

/** Qué destinos puede mover quien pide (módulos de su organización + permisos). */
export async function libraryAccess(session: Subject): Promise<{ chat: boolean; rag: boolean }> {
  const [knowledge, kbDocs] = await Promise.all([
    orgHasModule(session.organizationId, "knowledge"),
    orgHasKbDocs(session.organizationId),
  ]);
  return {
    chat: knowledge && can(session, "knowledge.manage"),
    rag: kbDocs && can(session, "agent.manage") && can(session, "knowledge.manage"),
  };
}

/** ¿El sistema de Documentos del agente existe para esta organización? (insignias). */
export async function ragAvailable(organizationId: string): Promise<boolean> {
  return orgHasKbDocs(organizationId);
}

/* ───────── Desde Estudio de IA → Documentos ───────── */

/**
 * Lo que guarda la Biblioteca de un documento que se sube en Documentos con
 * «Disponible en Bandeja». El .md se guarda como texto plano: es lo que
 * WhatsApp sabe abrir.
 */
export async function createChatCopy(input: {
  organizationId: string;
  userId: string;
  title: string;
  filename: string;
  mime: KbDocMime;
  bytes: Uint8Array;
}): Promise<KnowledgeRow> {
  return createKnowledge({
    organizationId: input.organizationId,
    userId: input.userId,
    title: input.title,
    body: "",
    tags: [],
    file: {
      data: Buffer.from(input.bytes),
      mimeType: input.mime === "text/markdown" ? "text/plain" : input.mime,
      fileName: input.filename,
    },
    showInChat: true,
  });
}

/** Si el documento no llegó a crearse, su copia en la Biblioteca tampoco se queda. */
export async function discardChatCopy(organizationId: string, entryId: string): Promise<void> {
  await deleteKnowledge(organizationId, entryId);
}

/** Enciende o apaga «Envío en chat» de un documento del agente (sin volver a subir). */
export async function setDocumentInChat(organizationId: string, documentId: string, on: boolean): Promise<KbDocument> {
  const doc = await getDocument(organizationId, documentId);
  if (!doc) throw new LibraryError("not_found");
  if (!doc.knowledgeEntryId) {
    if (!on) return doc;
    throw new LibraryError("no_original");
  }
  const row = await setKnowledgeInChat(organizationId, doc.knowledgeEntryId, on);
  if (!row) throw new LibraryError("no_original");
  return doc;
}

/**
 * Borra el documento del agente. Si su original estaba guardado SOLO para él
 * (oculto de la Bandeja), se borra también: no queda un archivo huérfano.
 * Si el original sigue en la Bandeja, se queda (solo deja de ser «Lectura IA»).
 */
export async function deleteDocumentAndHiddenOriginal(organizationId: string, documentId: string): Promise<boolean> {
  const doc = await getDocument(organizationId, documentId);
  if (!doc) return false;
  const deleted = await deleteDocument(organizationId, documentId);
  if (deleted && doc.knowledgeEntryId) {
    const entry = await getKnowledge(organizationId, doc.knowledgeEntryId);
    if (entry && !entry.showInChat) await deleteKnowledge(organizationId, entry.id);
  }
  return deleted;
}

/* ───────── Desde CRM Comercial → Biblioteca ───────── */

const KB_EXT = /\.(pdf|txt|md|markdown)$/i;

/**
 * El texto que leerá el agente: el del archivo si es .pdf/.txt/.md; si no
 * (una imagen, un Word), el título y el texto de la entrada.
 */
async function textOfEntry(
  organizationId: string,
  entry: KnowledgeRow
): Promise<{ text: string; mime: KbDocMime; filename: string; byteSize: number }> {
  if (entry.filePath && entry.fileName && KB_EXT.test(entry.fileName)) {
    // 044: el mismo tope que al subir a Documentos (Plataforma o el entorno):
    // un PDF de 100 MB de la Biblioteca no se abre entero en memoria.
    const { maxFileBytes } = await getKbDocLimits(organizationId);
    if ((entry.fileSize ?? 0) > maxFileBytes) {
      throw new KbDocError("too_large", `Para que la IA lo lea, el archivo debe pesar hasta ${formatBytes(maxFileBytes)}; este pesa ${formatBytes(entry.fileSize ?? 0)}.`);
    }
    const bytes = new Uint8Array(await readKnowledgeFile(organizationId, entry));
    const format = detectFormat(entry.fileName, bytes.subarray(0, 8));
    if (format.ok) {
      const extracted = await extractDocumentText(entry.fileName, bytes);
      if (!extracted.ok) throw new KbDocError(extracted.code);
      return { text: extracted.text, mime: extracted.mime, filename: entry.fileName, byteSize: bytes.length };
    }
  }
  const body = entry.body.trim();
  if (!body) throw new LibraryError("not_eligible");
  const text = normalizeText(`${entry.title}\n\n${body}`);
  return { text, mime: "text/plain", filename: `${entry.title.slice(0, 200)}.txt`, byteSize: Buffer.byteLength(text) };
}

/**
 * Enciende «Entrenar también al Agente de IA» para una entrada: extrae el
 * texto y crea el documento por la puerta oficial (límites de documentos y
 * fragmentos, duplicados, tope de almacenamiento). Idempotente: si ya
 * existe, lo devuelve.
 */
export async function enableRagForEntry(input: {
  organizationId: string;
  userId: string;
  entry: KnowledgeRow;
  /** `null` = General. */
  groupId: string | null;
}): Promise<KbDocument> {
  const { organizationId, entry } = input;
  const existing = await getDocumentByEntry(organizationId, entry.id);
  if (existing) return existing;
  const { text, mime, filename, byteSize } = await textOfEntry(organizationId, entry);
  if (text.length > KB_DOC_MAX_CHARS) throw new KbDocError("too_long");
  // Lo que ocupa: su texto y el de sus fragmentos (≈ 2 × texto), como en Documentos.
  await assertCanUpload(organizationId, Buffer.byteLength(text) * 2);
  const doc = await createDocument(organizationId, {
    title: entry.title.slice(0, 200),
    filename,
    mime,
    byteSize,
    text,
    contentSha256: createHash("sha256").update(text).digest("hex"),
    uploadedByUserId: input.userId,
    groupId: input.groupId,
    knowledgeEntryId: entry.id,
  });
  scheduleIndex(organizationId, doc.id);
  void checkStorageAlerts(organizationId);
  return doc;
}

/**
 * Si cambió el archivo o el texto de una entrada que alimenta a la IA, su
 * documento se rehace con el contenido nuevo (mismo grupo). Sin documento, o
 * con el mismo texto, nada.
 */
export async function refreshRagForEntry(organizationId: string, userId: string, entry: KnowledgeRow): Promise<void> {
  const doc = await getDocumentByEntry(organizationId, entry.id);
  if (!doc) return;
  const { text } = await textOfEntry(organizationId, entry);
  if (createHash("sha256").update(text).digest("hex") === doc.contentSha256) return;
  await deleteDocument(organizationId, doc.id);
  await enableRagForEntry({ organizationId, userId, entry, groupId: doc.groupId });
}

/** Apaga «Lectura IA»: borra el documento y sus fragmentos (el archivo de la Biblioteca se queda). */
export async function disableRagForEntry(organizationId: string, entry: KnowledgeRow): Promise<void> {
  if (!entry.showInChat) throw new LibraryError("last_destination");
  const doc = await getDocumentByEntry(organizationId, entry.id);
  if (doc) await deleteDocument(organizationId, doc.id);
}

/** Enciende o apaga «Envío en chat» de una entrada. Apagarlo pide que siga siendo «Lectura IA». */
export async function setEntryInChat(organizationId: string, entry: KnowledgeRow, on: boolean): Promise<KnowledgeRow> {
  if (!on && !(await getDocumentByEntry(organizationId, entry.id))) throw new LibraryError("last_destination");
  const row = await setKnowledgeInChat(organizationId, entry.id, on);
  if (!row) throw new LibraryError("not_found");
  return row;
}
