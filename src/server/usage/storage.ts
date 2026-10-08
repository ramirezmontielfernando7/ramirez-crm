import { isNotNull, sql } from "drizzle-orm";
import { getDb, getSystemDb, schema, type Db } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { buildStorageUsage, type StorageUsage } from "@/lib/usage";

/**
 * 036 (PR 2) — Cuánto almacenamiento ocupa una organización (APROXIMADO; qué
 * incluye y qué no, en `src/lib/usage.ts`). Solo lectura: sumas de lo que la
 * BD ya sabe de cada archivo, sin tocar el disco ni escribir nada.
 *
 * - `getOrgStorageUsage(org)`: la de UNA organización, con el pool de la app
 *   (RLS) y `scoped()`. Para «Uso y plan» del Propietario (PR 6): llámala
 *   dentro del contexto de esa organización (`withAuth`, `runWithOrganization`).
 * - `getAllOrgsStorageUsage()`: la de TODAS, agrupada, con el pool de sistema.
 *   Solo para el administrador de plataforma (detrás de `withPlatformAdmin`):
 *   son totales, nunca contenido de un negocio.
 *
 * Documentos del agente: solo se leen `kb_document.text`, `kb_chunk.content`
 * y `kb_chunk.embedding`, sin filtrar por agente ni grupo: todo documento de
 * la organización ocupa lo mismo, sea compartido o exclusivo.
 */

// Las sumas: `coalesce` para que una organización sin filas dé 0, no NULL.
const MEDIA_BYTES = sql<string>`coalesce(sum(${schema.mediaAsset.fileSize}), 0)`;
const MEDIA_SIN_TAMANO = sql<string>`count(*) filter (where ${schema.mediaAsset.fileSize} is null)`;
const KNOWLEDGE_BYTES = sql<string>`coalesce(sum(${schema.knowledgeEntry.fileSize}), 0)`;
const KNOWLEDGE_SIN_TAMANO = sql<string>`count(*) filter (where ${schema.knowledgeEntry.fileSize} is null)`;
const TEAM_CHAT_BYTES = sql<string>`coalesce(sum(${schema.teamChatAttachment.fileSize}), 0)`;
const DOC_TEXT_BYTES = sql<string>`coalesce(sum(octet_length(${schema.kbDocument.text})), 0)`;
const CHUNK_TEXT_BYTES = sql<string>`coalesce(sum(octet_length(${schema.kbChunk.content})), 0)`;
const CHUNK_VECTOR_VALUES = sql<string>`coalesce(sum(coalesce(cardinality(${schema.kbChunk.embedding}), 0)), 0)`;

// Solo cuenta un archivo de WhatsApp que sí está en disco (descargado);
// uno pendiente o fallido no ocupa nada todavía.
const MEDIA_EN_DISCO = isNotNull(schema.mediaAsset.storagePath);
const KNOWLEDGE_CON_ARCHIVO = isNotNull(schema.knowledgeEntry.filePath);

/** El almacenamiento de UNA organización (pool de la app, RLS). */
export async function getOrgStorageUsage(organizationId: string, db: Db = getDb()): Promise<StorageUsage> {
  const [media, knowledge, teamChat, docs, chunks] = await Promise.all([
    db
      .select({ bytes: MEDIA_BYTES, sinTamano: MEDIA_SIN_TAMANO })
      .from(schema.mediaAsset)
      .where(scoped(schema.mediaAsset.organizationId, organizationId, MEDIA_EN_DISCO)),
    db
      .select({ bytes: KNOWLEDGE_BYTES, sinTamano: KNOWLEDGE_SIN_TAMANO })
      .from(schema.knowledgeEntry)
      .where(scoped(schema.knowledgeEntry.organizationId, organizationId, KNOWLEDGE_CON_ARCHIVO)),
    db
      .select({ bytes: TEAM_CHAT_BYTES })
      .from(schema.teamChatAttachment)
      .where(scoped(schema.teamChatAttachment.organizationId, organizationId)),
    db
      .select({ bytes: DOC_TEXT_BYTES })
      .from(schema.kbDocument)
      .where(scoped(schema.kbDocument.organizationId, organizationId)),
    db
      .select({ bytes: CHUNK_TEXT_BYTES, values: CHUNK_VECTOR_VALUES })
      .from(schema.kbChunk)
      .where(scoped(schema.kbChunk.organizationId, organizationId)),
  ]);
  return buildStorageUsage({
    whatsapp: media[0]?.bytes,
    knowledge: knowledge[0]?.bytes,
    teamChat: teamChat[0]?.bytes,
    documents: {
      textBytes: docs[0]?.bytes,
      chunkTextBytes: chunks[0]?.bytes,
      embeddingValues: chunks[0]?.values,
    },
    filesWithoutSize: Number(media[0]?.sinTamano ?? 0) + Number(knowledge[0]?.sinTamano ?? 0),
  });
}

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys(): Db {
  return getSystemDb();
}

/**
 * El almacenamiento de TODAS las organizaciones (pool de sistema), una
 * consulta agrupada por tabla. Las que no tienen nada no aparecen: usa
 * `emptyStorageUsage()` para ellas.
 */
export async function getAllOrgsStorageUsage(): Promise<Map<string, StorageUsage>> {
  const db = sys();
  const [media, knowledge, teamChat, docs, chunks] = await Promise.all([
    db
      .select({ org: schema.mediaAsset.organizationId, bytes: MEDIA_BYTES, sinTamano: MEDIA_SIN_TAMANO })
      .from(schema.mediaAsset)
      .where(MEDIA_EN_DISCO)
      .groupBy(schema.mediaAsset.organizationId),
    db
      .select({ org: schema.knowledgeEntry.organizationId, bytes: KNOWLEDGE_BYTES, sinTamano: KNOWLEDGE_SIN_TAMANO })
      .from(schema.knowledgeEntry)
      .where(KNOWLEDGE_CON_ARCHIVO)
      .groupBy(schema.knowledgeEntry.organizationId),
    db
      .select({ org: schema.teamChatAttachment.organizationId, bytes: TEAM_CHAT_BYTES })
      .from(schema.teamChatAttachment)
      .groupBy(schema.teamChatAttachment.organizationId),
    db
      .select({ org: schema.kbDocument.organizationId, bytes: DOC_TEXT_BYTES })
      .from(schema.kbDocument)
      .groupBy(schema.kbDocument.organizationId),
    db
      .select({ org: schema.kbChunk.organizationId, bytes: CHUNK_TEXT_BYTES, values: CHUNK_VECTOR_VALUES })
      .from(schema.kbChunk)
      .groupBy(schema.kbChunk.organizationId),
  ]);

  const orgs = new Set([...media, ...knowledge, ...teamChat, ...docs, ...chunks].map((r) => r.org));
  const porOrg = <R extends { org: string }>(rows: R[]) => new Map(rows.map((r) => [r.org, r]));
  const m = porOrg(media);
  const k = porOrg(knowledge);
  const tc = porOrg(teamChat);
  const d = porOrg(docs);
  const c = porOrg(chunks);

  const out = new Map<string, StorageUsage>();
  for (const org of orgs) {
    out.set(
      org,
      buildStorageUsage({
        whatsapp: m.get(org)?.bytes,
        knowledge: k.get(org)?.bytes,
        teamChat: tc.get(org)?.bytes,
        documents: {
          textBytes: d.get(org)?.bytes,
          chunkTextBytes: c.get(org)?.bytes,
          embeddingValues: c.get(org)?.values,
        },
        filesWithoutSize: Number(m.get(org)?.sinTamano ?? 0) + Number(k.get(org)?.sinTamano ?? 0),
      })
    );
  }
  return out;
}
