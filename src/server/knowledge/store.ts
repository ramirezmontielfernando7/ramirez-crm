import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { KnowledgeEntryDto } from "@/lib/knowledge";
import { matchesQuery } from "@/lib/search";
import {
  deleteMediaFile,
  kindFromMime,
  readMediaFile,
  saveMediaFile,
  validateOutgoing,
} from "@/server/whatsapp/media";

/**
 * 024 — Conocimientos: la ÚNICA puerta que lee y escribe `knowledge_entry`.
 *
 * Todo pasa por `scoped()`: son datos del NEGOCIO (no de clientes), así que
 * cualquier rol con sesión los ve; escribir lo decide la ruta con
 * `knowledge.manage`. El agente de IA no lee esta tabla.
 */

export type KnowledgeRow = typeof schema.knowledgeEntry.$inferSelect;

export type KnowledgeFileInput = { data: Buffer; mimeType: string; fileName: string };

/** Cuántas entradas devuelve una búsqueda (la lista y el buscador del chat). */
const LIST_LIMIT = 200;

export function serializeKnowledge(row: KnowledgeRow): KnowledgeEntryDto {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tags: row.tags,
    file:
      row.filePath && row.fileMime
        ? {
            name: row.fileName ?? "archivo",
            mime: row.fileMime,
            size: row.fileSize ?? 0,
            // `v` rompe la caché del navegador cuando se reemplaza el archivo.
            url: `/api/knowledge/${row.id}/file?v=${row.updatedAt.getTime()}`,
            kind: kindFromMime(row.fileMime),
          }
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Búsqueda por título, contenido, etiquetas y nombre de archivo, sin acentos
 * ni mayúsculas (la misma regla de Bandeja y Contactos, `lib/search.ts`). Se
 * filtra en memoria: la base de un negocio son decenas o cientos de entradas.
 */
export async function listKnowledge(
  organizationId: string,
  opts: { q?: string; tag?: string } = {}
): Promise<KnowledgeRow[]> {
  const rows = await getDb()
    .select()
    .from(schema.knowledgeEntry)
    .where(scoped(schema.knowledgeEntry.organizationId, organizationId))
    .orderBy(desc(schema.knowledgeEntry.updatedAt));
  const tag = opts.tag?.trim().toLowerCase();
  return rows
    .filter((r) => !tag || r.tags.some((t) => t.toLowerCase() === tag))
    .filter((r) =>
      matchesQuery(opts.q ?? "", { text: [r.title, r.body, r.fileName, ...r.tags] })
    )
    .slice(0, LIST_LIMIT);
}

/** Todas las etiquetas en uso, para el filtro. */
export async function knowledgeTags(organizationId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ tags: schema.knowledgeEntry.tags })
    .from(schema.knowledgeEntry)
    .where(scoped(schema.knowledgeEntry.organizationId, organizationId));
  const byKey = new Map<string, string>();
  for (const r of rows) for (const t of r.tags) byKey.set(t.toLowerCase(), byKey.get(t.toLowerCase()) ?? t);
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, "es"));
}

export async function getKnowledge(
  organizationId: string,
  id: string
): Promise<KnowledgeRow | null> {
  const [row] = await getDb()
    .select()
    .from(schema.knowledgeEntry)
    .where(scoped(schema.knowledgeEntry.organizationId, organizationId, eq(schema.knowledgeEntry.id, id)))
    .limit(1);
  return row ?? null;
}

/** Valida el archivo con los límites de WhatsApp: lo que se sube se puede enviar. */
function checkFile(file: KnowledgeFileInput): void {
  validateOutgoing(file.mimeType, file.data.byteLength);
}

export async function createKnowledge(input: {
  organizationId: string;
  userId: string;
  title: string;
  body: string;
  tags: string[];
  file: KnowledgeFileInput | null;
}): Promise<KnowledgeRow> {
  if (input.file) checkFile(input.file);
  const id = newId("knowledgeEntry");
  const filePath = input.file
    ? await saveMediaFile(input.organizationId, id, input.file.data)
    : null;
  const [row] = await getDb()
    .insert(schema.knowledgeEntry)
    .values({
      id,
      organizationId: input.organizationId,
      title: input.title,
      body: input.body,
      tags: input.tags,
      filePath,
      fileName: input.file?.fileName ?? null,
      fileMime: input.file?.mimeType ?? null,
      fileSize: input.file?.data.byteLength ?? null,
      createdByUserId: input.userId,
    })
    .returning();
  return row!;
}

export async function updateKnowledge(
  organizationId: string,
  id: string,
  patch: {
    title?: string;
    body?: string;
    tags?: string[];
    /** Archivo nuevo (reemplaza), `null` = quitarlo, `undefined` = no tocar. */
    file?: KnowledgeFileInput | null;
  }
): Promise<KnowledgeRow | null> {
  const current = await getKnowledge(organizationId, id);
  if (!current) return null;
  if (patch.file) checkFile(patch.file);

  const fileCols =
    patch.file === undefined
      ? {}
      : patch.file === null
        ? { filePath: null, fileName: null, fileMime: null, fileSize: null }
        : {
            filePath: await saveMediaFile(organizationId, id, patch.file.data),
            fileName: patch.file.fileName,
            fileMime: patch.file.mimeType,
            fileSize: patch.file.data.byteLength,
          };
  if (patch.file === null && current.filePath) await deleteMediaFile(organizationId, id);

  const [row] = await getDb()
    .update(schema.knowledgeEntry)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...fileCols,
      updatedAt: new Date(),
    })
    .where(
      and(
        scoped(schema.knowledgeEntry.organizationId, organizationId),
        eq(schema.knowledgeEntry.id, id)
      )
    )
    .returning();
  return row ?? null;
}

export async function deleteKnowledge(organizationId: string, id: string): Promise<boolean> {
  const [row] = await getDb()
    .delete(schema.knowledgeEntry)
    .where(scoped(schema.knowledgeEntry.organizationId, organizationId, eq(schema.knowledgeEntry.id, id)))
    .returning({ filePath: schema.knowledgeEntry.filePath });
  if (!row) return false;
  if (row.filePath) await deleteMediaFile(organizationId, id);
  return true;
}

export async function readKnowledgeFile(organizationId: string, row: KnowledgeRow): Promise<Buffer> {
  return readMediaFile(organizationId, row.id);
}
