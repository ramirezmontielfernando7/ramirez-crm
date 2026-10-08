import { and, asc, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { getDb, getSystemDb, schema, withTenant, type Db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { KbDocErrorCode, KbDocMime } from "@/lib/kb-docs";
import { getKbDocLimits } from "./limits";

/**
 * 035 — ÚNICA puerta de `kb_document` y `kb_chunk` (los documentos que lee el
 * agente). Todo con `scoped()` a nombre de la organización y, lo que decide
 * un límite, bajo el candado de la organización (`pg_advisory_xact_lock`):
 * dos subidas a la vez no pasan las dos si solo cabía una.
 * Guardarraíl: `tests/unit/kb-docs-gate.test.ts`.
 */

export type KbDocument = typeof schema.kbDocument.$inferSelect;

export class KbDocError extends Error {
  constructor(readonly code: KbDocErrorCode) {
    super(code);
    this.name = "KbDocError";
  }
}

/** Lo que ve la pantalla (sin el texto completo). */
export type KbDocumentDto = {
  id: string;
  title: string;
  filename: string;
  mime: KbDocMime;
  byteSize: number;
  charCount: number;
  status: KbDocument["status"];
  errorCode: string | null;
  chunkCount: number;
  embeddingModel: string | null;
  createdAt: string;
  indexedAt: string | null;
};

export function toDto(d: KbDocument): KbDocumentDto {
  return {
    id: d.id,
    title: d.title,
    filename: d.filename,
    mime: d.mime,
    byteSize: d.byteSize,
    charCount: d.charCount,
    status: d.status,
    errorCode: d.errorCode,
    chunkCount: d.chunkCount,
    embeddingModel: d.embeddingModel,
    createdAt: d.createdAt.toISOString(),
    indexedAt: d.indexedAt?.toISOString() ?? null,
  };
}

async function lockOrg(tx: Db, organizationId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`kb_docs:${organizationId}`}))`);
}

export async function listDocuments(organizationId: string): Promise<KbDocument[]> {
  return getDb()
    .select()
    .from(schema.kbDocument)
    .where(scoped(schema.kbDocument.organizationId, organizationId))
    .orderBy(desc(schema.kbDocument.createdAt));
}

export async function getDocument(organizationId: string, id: string): Promise<KbDocument | null> {
  const [row] = await getDb()
    .select()
    .from(schema.kbDocument)
    .where(scoped(schema.kbDocument.organizationId, organizationId, eq(schema.kbDocument.id, id)))
    .limit(1);
  return row ?? null;
}

/** Cuántos documentos y fragmentos tiene la organización. */
export async function getUsage(organizationId: string, db: Db = getDb()): Promise<{ documents: number; chunks: number }> {
  const [row] = await db
    .select({
      documents: sql<number>`count(*)::int`,
      chunks: sql<number>`coalesce(sum(${schema.kbDocument.chunkCount}), 0)::int`,
    })
    .from(schema.kbDocument)
    .where(scoped(schema.kbDocument.organizationId, organizationId));
  return { documents: row?.documents ?? 0, chunks: row?.chunks ?? 0 };
}

export async function createDocument(
  organizationId: string,
  input: {
    title: string;
    filename: string;
    mime: KbDocMime;
    byteSize: number;
    text: string;
    contentSha256: string;
    uploadedByUserId: string | null;
  }
): Promise<KbDocument> {
  try {
    return await withTenant(organizationId, async (tx) => {
      await lockOrg(tx, organizationId);
      const limits = await getKbDocLimits(organizationId, tx);
      const usage = await getUsage(organizationId, tx);
      if (usage.documents >= limits.maxDocuments) throw new KbDocError("document_limit");
      const [dup] = await tx
        .select({ id: schema.kbDocument.id })
        .from(schema.kbDocument)
        .where(scoped(schema.kbDocument.organizationId, organizationId, eq(schema.kbDocument.contentSha256, input.contentSha256)))
        .limit(1);
      if (dup) throw new KbDocError("duplicate");
      const [row] = await tx
        .insert(schema.kbDocument)
        .values({
          id: newId("kbDocument"),
          organizationId,
          title: input.title,
          filename: input.filename.slice(0, 255),
          mime: input.mime,
          byteSize: input.byteSize,
          charCount: input.text.length,
          contentSha256: input.contentSha256,
          text: input.text,
          uploadedByUserId: input.uploadedByUserId,
        })
        .returning();
      return row!;
    });
  } catch (err) {
    // Dos subidas idénticas a la vez: la segunda choca con el UNIQUE.
    if ((err as { code?: string }).code === "23505") throw new KbDocError("duplicate");
    throw err;
  }
}

export async function deleteDocument(organizationId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(schema.kbDocument)
    .where(scoped(schema.kbDocument.organizationId, organizationId, eq(schema.kbDocument.id, id)))
    .returning({ id: schema.kbDocument.id });
  return rows.length > 0;
}

/** Vuelve a poner en cola un documento (Reindexar). `null` si no existe. */
export async function requeueDocument(organizationId: string, id: string): Promise<KbDocument | null> {
  const [row] = await getDb()
    .update(schema.kbDocument)
    .set({ status: "pending", errorCode: null, updatedAt: new Date() })
    .where(scoped(schema.kbDocument.organizationId, organizationId, eq(schema.kbDocument.id, id)))
    .returning();
  return row ?? null;
}

/* ------------------------------------------------------------------
 * Indexado (src/server/kb-docs/indexer.ts)
 * ---------------------------------------------------------------- */

/** Marca el documento como «Indexando» y devuelve su texto. `null` si ya no existe. */
export async function claimDocument(organizationId: string, id: string): Promise<KbDocument | null> {
  const [row] = await getDb()
    .update(schema.kbDocument)
    .set({ status: "processing", errorCode: null, updatedAt: new Date() })
    .where(scoped(schema.kbDocument.organizationId, organizationId, eq(schema.kbDocument.id, id)))
    .returning();
  return row ?? null;
}

/**
 * Cambia los fragmentos del documento por estos (sin vectores todavía),
 * respetando el tope de fragmentos de la organización. Con `final` el
 * documento queda «Listo» (no habrá vectores); si no, sigue «Indexando» hasta
 * `markReady` (después de pedir los vectores, salgan o no).
 */
export async function replaceChunks(
  organizationId: string,
  documentId: string,
  contents: string[],
  opts: { final: boolean } = { final: true }
): Promise<{ id: string; content: string }[]> {
  return withTenant(organizationId, async (tx) => {
    await lockOrg(tx, organizationId);
    const [doc] = await tx
      .select({ id: schema.kbDocument.id })
      .from(schema.kbDocument)
      .where(scoped(schema.kbDocument.organizationId, organizationId, eq(schema.kbDocument.id, documentId)))
      .limit(1);
    if (!doc) throw new KbDocError("internal");
    const limits = await getKbDocLimits(organizationId, tx);
    const [others] = await tx
      .select({ n: sql<number>`coalesce(sum(${schema.kbDocument.chunkCount}), 0)::int` })
      .from(schema.kbDocument)
      .where(scoped(schema.kbDocument.organizationId, organizationId, ne(schema.kbDocument.id, documentId)));
    if ((others?.n ?? 0) + contents.length > limits.maxChunks) throw new KbDocError("chunk_limit");

    await tx
      .delete(schema.kbChunk)
      .where(scoped(schema.kbChunk.organizationId, organizationId, eq(schema.kbChunk.documentId, documentId)));
    const rows = contents.map((content, ordinal) => ({
      id: newId("kbChunk"),
      organizationId,
      documentId,
      ordinal,
      content,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      await tx.insert(schema.kbChunk).values(rows.slice(i, i + 200));
    }
    await tx
      .update(schema.kbDocument)
      .set({
        status: opts.final ? "ready" : "processing",
        errorCode: null,
        chunkCount: rows.length,
        embeddingModel: null,
        indexedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(scoped(schema.kbDocument.organizationId, organizationId, eq(schema.kbDocument.id, documentId)));
    return rows.map((r) => ({ id: r.id, content: r.content }));
  });
}

/** Los fragmentos de un documento (para completar vectores). */
export async function listChunks(organizationId: string, documentId: string): Promise<{ id: string; content: string; embeddingModel: string | null }[]> {
  return getDb()
    .select({ id: schema.kbChunk.id, content: schema.kbChunk.content, embeddingModel: schema.kbChunk.embeddingModel })
    .from(schema.kbChunk)
    .where(scoped(schema.kbChunk.organizationId, organizationId, eq(schema.kbChunk.documentId, documentId)))
    .orderBy(asc(schema.kbChunk.ordinal));
}

/**
 * Guarda los vectores de los fragmentos y marca el documento con el modelo.
 * Si el documento se borró a la mitad, no pasa nada (0 filas).
 */
export async function saveEmbeddings(
  organizationId: string,
  documentId: string,
  model: string,
  vectors: { id: string; embedding: Float32Array }[]
): Promise<void> {
  await withTenant(organizationId, async (tx) => {
    for (const v of vectors) {
      await tx
        .update(schema.kbChunk)
        .set({ embedding: Array.from(v.embedding), embeddingModel: model })
        .where(scoped(schema.kbChunk.organizationId, organizationId, eq(schema.kbChunk.id, v.id), eq(schema.kbChunk.documentId, documentId)));
    }
    await tx
      .update(schema.kbDocument)
      .set({ embeddingModel: model, updatedAt: new Date() })
      .where(scoped(schema.kbDocument.organizationId, organizationId, eq(schema.kbDocument.id, documentId)));
  });
}

/** El documento ya se puede buscar (con o sin vectores). */
export async function markReady(organizationId: string, documentId: string): Promise<void> {
  await getDb()
    .update(schema.kbDocument)
    .set({ status: "ready", errorCode: null, indexedAt: new Date(), updatedAt: new Date() })
    .where(scoped(schema.kbDocument.organizationId, organizationId, eq(schema.kbDocument.id, documentId)));
}

export async function failDocument(organizationId: string, documentId: string, code: KbDocErrorCode): Promise<void> {
  await getDb()
    .update(schema.kbDocument)
    .set({ status: "failed", errorCode: code, updatedAt: new Date() })
    .where(scoped(schema.kbDocument.organizationId, organizationId, eq(schema.kbDocument.id, documentId)));
}

/**
 * Al arrancar: lo que hay que (re)tomar en TODAS las organizaciones —en cola,
 * a medias, o listo sin vectores del modelo actual—. Solo ids: el trabajo de
 * cada uno corre después a nombre de su organización. Pool de sistema: es
 * trabajo de plataforma que decide a qué organización le toca
 * (`system-db-guard.test.ts`).
 */
export async function documentsToResume(currentModel: string | null): Promise<{ organizationId: string; id: string }[]> {
  const d = schema.kbDocument;
  const pendiente = inArray(d.status, ["pending", "processing"]);
  const sinVectores = currentModel
    ? and(eq(d.status, "ready"), or(sql`${d.embeddingModel} is null`, ne(d.embeddingModel, currentModel)), sql`${d.chunkCount} > 0`)
    : undefined;
  return getSystemDb()
    .select({ organizationId: d.organizationId, id: d.id })
    .from(schema.kbDocument)
    .where(sinVectores ? or(pendiente, sinVectores) : pendiente)
    .orderBy(asc(d.createdAt));
}

/* ------------------------------------------------------------------
 * Recuperación (src/server/kb-docs/retrieve.ts)
 * ---------------------------------------------------------------- */

export type ChunkHit = { id: string; documentId: string; title: string; content: string };

/** Búsqueda por texto (`tsquery` ya saneada por `lexicalQuery`). */
export async function lexicalSearch(organizationId: string, tsquery: string, limit: number): Promise<ChunkHit[]> {
  const c = schema.kbChunk;
  const d = schema.kbDocument;
  const q = sql`to_tsquery('spanish'::regconfig, ${tsquery})`;
  return getDb()
    .select({ id: c.id, documentId: c.documentId, title: d.title, content: c.content })
    .from(schema.kbChunk)
    .innerJoin(schema.kbDocument, and(eq(d.organizationId, c.organizationId), eq(d.id, c.documentId)))
    .where(scoped(c.organizationId, organizationId, eq(d.status, "ready"), sql`${c.tsv} @@ ${q}`))
    .orderBy(sql`ts_rank_cd(${c.tsv}, ${q}) desc`, asc(c.id))
    .limit(limit);
}

/**
 * Firma barata de lo indexado (para la caché de vectores): cambia al subir,
 * borrar o reindexar cualquier documento.
 */
export async function indexSignature(organizationId: string): Promise<string> {
  const d = schema.kbDocument;
  const [row] = await getDb()
    .select({
      n: sql<number>`count(*)::int`,
      chunks: sql<number>`coalesce(sum(${d.chunkCount}), 0)::int`,
      at: sql<string | null>`max(${d.updatedAt})::text`,
    })
    .from(schema.kbDocument)
    .where(scoped(d.organizationId, organizationId, eq(d.status, "ready")));
  return `${row?.n ?? 0}:${row?.chunks ?? 0}:${row?.at ?? ""}`;
}

/** ¿La organización tiene algún documento listo? (atajo: sin documentos no se busca nada). */
export async function hasReadyDocuments(organizationId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.kbDocument.id })
    .from(schema.kbDocument)
    .where(scoped(schema.kbDocument.organizationId, organizationId, eq(schema.kbDocument.status, "ready")))
    .limit(1);
  return Boolean(row);
}

/** Los vectores de la organización hechos con `model` (solo documentos listos). */
export async function loadVectors(organizationId: string, model: string): Promise<{ id: string; embedding: number[] }[]> {
  const c = schema.kbChunk;
  const d = schema.kbDocument;
  const rows = await getDb()
    .select({ id: c.id, embedding: c.embedding })
    .from(schema.kbChunk)
    .innerJoin(schema.kbDocument, and(eq(d.organizationId, c.organizationId), eq(d.id, c.documentId)))
    .where(scoped(c.organizationId, organizationId, eq(d.status, "ready"), eq(c.embeddingModel, model), isNotNull(c.embedding)));
  return rows.filter((r): r is { id: string; embedding: number[] } => Array.isArray(r.embedding));
}

export async function chunksByIds(organizationId: string, ids: string[]): Promise<ChunkHit[]> {
  if (ids.length === 0) return [];
  const c = schema.kbChunk;
  const d = schema.kbDocument;
  return getDb()
    .select({ id: c.id, documentId: c.documentId, title: d.title, content: c.content })
    .from(schema.kbChunk)
    .innerJoin(schema.kbDocument, and(eq(d.organizationId, c.organizationId), eq(d.id, c.documentId)))
    .where(scoped(c.organizationId, organizationId, inArray(c.id, ids), eq(d.status, "ready")));
}
