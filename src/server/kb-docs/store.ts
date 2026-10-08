import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb, getSystemDb, schema, withTenant, type Db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { GENERAL_GROUP_KEY, GENERAL_GROUP_NAME, MAX_DOC_GROUPS, type DocScope, type KbDocErrorCode, type KbDocMime, type KbGroupErrorCode } from "@/lib/kb-docs";
import { getKbDocLimits } from "./limits";

/**
 * 035 — ÚNICA puerta de `kb_document` y `kb_chunk` (los documentos que lee el
 * agente). Todo con `scoped()` a nombre de la organización y, lo que decide
 * un límite, bajo el candado de la organización (`pg_advisory_xact_lock`):
 * dos subidas a la vez no pasan las dos si solo cabía una.
 * 037: también de `kb_document_group` (los grupos; «General» es
 * `group_id IS NULL`, no una fila).
 * Guardarraíl: `tests/unit/kb-docs-gate.test.ts`.
 */

export type KbDocument = typeof schema.kbDocument.$inferSelect;

export class KbDocError extends Error {
  /** `detail`: el motivo con más contexto (p. ej. dónde está el duplicado). */
  constructor(
    readonly code: KbDocErrorCode,
    readonly detail?: string
  ) {
    super(code);
    this.name = "KbDocError";
  }
}

/** 037 — Errores de los grupos (nombre, tope, no existe). */
export class KbGroupError extends Error {
  constructor(readonly code: KbGroupErrorCode) {
    super(code);
    this.name = "KbGroupError";
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
  /** 037 — `null` = General. */
  groupId: string | null;
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
    groupId: d.groupId,
  };
}

/** Violación de UNIQUE (23505), venga directa de postgres o envuelta por drizzle en `cause`. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

async function lockOrg(tx: Db, organizationId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`kb_docs:${organizationId}`}))`);
}

/** 037 — Los documentos de la EMPRESA (no los exclusivos de un agente). */
const ofCompany = () => isNull(schema.kbDocument.agentId);

/**
 * Los documentos de la empresa; con `groupId` (037), solo los de ese grupo
 * (`null` = General).
 */
export async function listDocuments(organizationId: string, opts: { groupId?: string | null } = {}): Promise<KbDocument[]> {
  const d = schema.kbDocument;
  const inGroup: SQL | undefined =
    opts.groupId === undefined ? undefined : opts.groupId === null ? isNull(d.groupId) : eq(d.groupId, opts.groupId);
  return getDb()
    .select()
    .from(schema.kbDocument)
    .where(scoped(d.organizationId, organizationId, ofCompany(), inGroup))
    .orderBy(desc(d.createdAt));
}

export async function getDocument(organizationId: string, id: string): Promise<KbDocument | null> {
  const [row] = await getDb()
    .select()
    .from(schema.kbDocument)
    .where(scoped(schema.kbDocument.organizationId, organizationId, eq(schema.kbDocument.id, id)))
    .limit(1);
  return row ?? null;
}

/**
 * Cuántos documentos y fragmentos tiene la organización. 037 (PR 3): los
 * exclusivos de un agente cuentan igual contra los límites; `exclusive` dice
 * cuántos de ellos lo son (para la pantalla).
 */
export async function getUsage(
  organizationId: string,
  db: Db = getDb()
): Promise<{ documents: number; chunks: number; exclusive: number }> {
  const [row] = await db
    .select({
      documents: sql<number>`count(*)::int`,
      chunks: sql<number>`coalesce(sum(${schema.kbDocument.chunkCount}), 0)::int`,
      exclusive: sql<number>`count(${schema.kbDocument.agentId})::int`,
    })
    .from(schema.kbDocument)
    .where(scoped(schema.kbDocument.organizationId, organizationId));
  return { documents: row?.documents ?? 0, chunks: row?.chunks ?? 0, exclusive: row?.exclusive ?? 0 };
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
    /** 037 — `null`/ausente = General. */
    groupId?: string | null;
    /**
     * 037 (PR 3) — Exclusivo de este agente (entonces sin grupo). Que el
     * agente exista y no esté archivado lo valida la ruta (`agents/store`);
     * la FK compuesta garantiza que sea de esta organización.
     */
    agentId?: string | null;
  }
): Promise<KbDocument> {
  const agentId = input.agentId ?? null;
  const groupId = agentId ? null : (input.groupId ?? null);
  try {
    return await withTenant(organizationId, async (tx) => {
      await lockOrg(tx, organizationId);
      if (groupId && !(await groupExists(tx, organizationId, groupId))) throw new KbGroupError("group_not_found");
      const limits = await getKbDocLimits(organizationId, tx);
      const usage = await getUsage(organizationId, tx);
      if (usage.documents >= limits.maxDocuments) throw new KbDocError("document_limit");
      const [dup] = await tx
        .select({ id: schema.kbDocument.id, groupName: schema.kbDocumentGroup.name, agentId: schema.kbDocument.agentId })
        .from(schema.kbDocument)
        .leftJoin(
          schema.kbDocumentGroup,
          and(eq(schema.kbDocumentGroup.organizationId, schema.kbDocument.organizationId), eq(schema.kbDocumentGroup.id, schema.kbDocument.groupId))
        )
        .where(scoped(schema.kbDocument.organizationId, organizationId, eq(schema.kbDocument.contentSha256, input.contentSha256)))
        .limit(1);
      if (dup) {
        throw new KbDocError(
          "duplicate",
          dup.agentId
            ? "Ese documento ya está subido como exclusivo de un agente."
            : `Ese documento ya está subido, en el grupo «${dup.groupName ?? GENERAL_GROUP_NAME}».`
        );
      }
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
          groupId,
          agentId,
        })
        .returning();
      return row!;
    });
  } catch (err) {
    // Dos subidas idénticas a la vez: la segunda choca con el UNIQUE.
    if (isUniqueViolation(err)) throw new KbDocError("duplicate");
    throw err;
  }
}

/** 037 (PR 3) — Los documentos exclusivos de un agente. */
export async function listAgentDocuments(organizationId: string, agentId: string): Promise<KbDocument[]> {
  const d = schema.kbDocument;
  return getDb()
    .select()
    .from(schema.kbDocument)
    .where(scoped(d.organizationId, organizationId, eq(d.agentId, agentId)))
    .orderBy(desc(d.createdAt));
}

/**
 * 037 (PR 3, D3) — Al archivar un agente, qué pasa con sus exclusivos, en la
 * transacción de quien archiva: `delete` los borra (con sus fragmentos, por
 * la FK); `move_to_general` los deja como documentos de la empresa en
 * General (`agent_id` y `group_id` NULL), y entonces los lee cualquier
 * agente con «Todos los documentos de la empresa». Devuelve cuántos eran.
 */
export async function settleAgentDocuments(
  tx: Db,
  organizationId: string,
  agentId: string,
  mode: "delete" | "move_to_general"
): Promise<number> {
  const d = schema.kbDocument;
  const rows =
    mode === "delete"
      ? await tx.delete(schema.kbDocument).where(scoped(d.organizationId, organizationId, eq(d.agentId, agentId))).returning({ id: d.id })
      : await tx
          .update(schema.kbDocument)
          .set({ agentId: null, groupId: null, updatedAt: new Date() })
          .where(scoped(d.organizationId, organizationId, eq(d.agentId, agentId)))
          .returning({ id: d.id });
  return rows.length;
}

export async function deleteDocument(organizationId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(schema.kbDocument)
    .where(scoped(schema.kbDocument.organizationId, organizationId, eq(schema.kbDocument.id, id)))
    .returning({ id: schema.kbDocument.id });
  return rows.length > 0;
}

/* ------------------------------------------------------------------
 * 037 — Grupos
 * ---------------------------------------------------------------- */

export type KbDocumentGroup = typeof schema.kbDocumentGroup.$inferSelect;

/** Un grupo con cuántos documentos tiene (`id: null` = General). */
export type KbGroupSummary = {
  id: string | null;
  name: string;
  documents: number;
  /** 037 (PR 2) — Agentes que eligen este grupo («Solo estos grupos»); lo llena la ruta. */
  agents?: number;
};

async function groupExists(tx: Db, organizationId: string, id: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.kbDocumentGroup.id })
    .from(schema.kbDocumentGroup)
    .where(scoped(schema.kbDocumentGroup.organizationId, organizationId, eq(schema.kbDocumentGroup.id, id)))
    .limit(1);
  return Boolean(row);
}

/** General primero (siempre existe) y luego los grupos en orden de alta, con sus documentos. */
export async function listGroups(organizationId: string): Promise<KbGroupSummary[]> {
  const g = schema.kbDocumentGroup;
  const d = schema.kbDocument;
  const [groups, counts] = await Promise.all([
    getDb().select().from(schema.kbDocumentGroup).where(scoped(g.organizationId, organizationId)).orderBy(asc(g.createdAt), asc(g.id)),
    getDb()
      .select({ groupId: d.groupId, n: sql<number>`count(*)::int` })
      .from(schema.kbDocument)
      .where(scoped(d.organizationId, organizationId, ofCompany()))
      .groupBy(d.groupId),
  ]);
  const byGroup = new Map(counts.map((c) => [c.groupId, c.n]));
  return [
    { id: null, name: GENERAL_GROUP_NAME, documents: byGroup.get(null) ?? 0 },
    ...groups.map((x) => ({ id: x.id, name: x.name, documents: byGroup.get(x.id) ?? 0 })),
  ];
}

export async function getGroup(organizationId: string, id: string): Promise<KbDocumentGroup | null> {
  const [row] = await getDb()
    .select()
    .from(schema.kbDocumentGroup)
    .where(scoped(schema.kbDocumentGroup.organizationId, organizationId, eq(schema.kbDocumentGroup.id, id)))
    .limit(1);
  return row ?? null;
}

/** El nombre ya viene limpio (`normalizeGroupName`). Tope bajo el candado: dos altas a la vez no lo pasan. */
export async function createGroup(organizationId: string, name: string): Promise<KbDocumentGroup> {
  try {
    return await withTenant(organizationId, async (tx) => {
      await lockOrg(tx, organizationId);
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.kbDocumentGroup)
        .where(scoped(schema.kbDocumentGroup.organizationId, organizationId));
      if ((row?.n ?? 0) >= MAX_DOC_GROUPS) throw new KbGroupError("group_limit");
      const [created] = await tx
        .insert(schema.kbDocumentGroup)
        .values({ id: newId("kbDocumentGroup"), organizationId, name })
        .returning();
      return created!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new KbGroupError("group_name_taken");
    throw err;
  }
}

export async function renameGroup(organizationId: string, id: string, name: string): Promise<KbDocumentGroup> {
  try {
    const [row] = await getDb()
      .update(schema.kbDocumentGroup)
      .set({ name, updatedAt: new Date() })
      .where(scoped(schema.kbDocumentGroup.organizationId, organizationId, eq(schema.kbDocumentGroup.id, id)))
      .returning();
    if (!row) throw new KbGroupError("group_not_found");
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) throw new KbGroupError("group_name_taken");
    throw err;
  }
}

/**
 * Borra el grupo. `documents: "move"` deja sus documentos en General;
 * `"delete"` los borra (con sus fragmentos, por la FK) — eso es lo único
 * irreversible. Todo en una transacción. Devuelve cuántos documentos tenía.
 */
export async function deleteGroup(
  organizationId: string,
  id: string,
  documents: "move" | "delete"
): Promise<{ documents: number }> {
  return withTenant(organizationId, async (tx) => {
    await lockOrg(tx, organizationId);
    const g = schema.kbDocumentGroup;
    const d = schema.kbDocument;
    const [group] = await tx
      .select({ id: g.id })
      .from(schema.kbDocumentGroup)
      .where(scoped(g.organizationId, organizationId, eq(g.id, id)))
      .limit(1)
      .for("update");
    if (!group) throw new KbGroupError("group_not_found");
    const affected =
      documents === "delete"
        ? await tx
            .delete(schema.kbDocument)
            .where(scoped(d.organizationId, organizationId, eq(d.groupId, id)))
            .returning({ id: d.id })
        : // Explícito (la FK haría lo mismo con SET NULL): así queda claro aquí.
          await tx
            .update(schema.kbDocument)
            .set({ groupId: null, updatedAt: new Date() })
            .where(scoped(d.organizationId, organizationId, eq(d.groupId, id)))
            .returning({ id: d.id });
    await tx.delete(schema.kbDocumentGroup).where(scoped(g.organizationId, organizationId, eq(g.id, id)));
    return { documents: affected.length };
  });
}

/**
 * 037 (PR 2) — De estos ids de grupo, cuáles existen en la organización
 * (`general` siempre). Para validar la selección de un agente al guardarla.
 */
export async function existingGroupIds(organizationId: string, ids: string[], db: Db = getDb()): Promise<Set<string>> {
  const named = [...new Set(ids)].filter((id) => id !== GENERAL_GROUP_KEY);
  const found = new Set<string>([GENERAL_GROUP_KEY]);
  if (named.length === 0) return found;
  const rows = await db
    .select({ id: schema.kbDocumentGroup.id })
    .from(schema.kbDocumentGroup)
    .where(scoped(schema.kbDocumentGroup.organizationId, organizationId, inArray(schema.kbDocumentGroup.id, named)));
  for (const r of rows) found.add(r.id);
  return found;
}

/** Mueve un documento de la empresa a otro grupo (`null` = General). `null` si el documento no existe. */
export async function moveDocument(organizationId: string, id: string, groupId: string | null): Promise<KbDocument | null> {
  return withTenant(organizationId, async (tx) => {
    if (groupId && !(await groupExists(tx, organizationId, groupId))) throw new KbGroupError("group_not_found");
    const [row] = await tx
      .update(schema.kbDocument)
      .set({ groupId, updatedAt: new Date() })
      .where(scoped(schema.kbDocument.organizationId, organizationId, eq(schema.kbDocument.id, id), ofCompany()))
      .returning();
    return row ?? null;
  });
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

export type ChunkHit = {
  id: string;
  documentId: string;
  title: string;
  content: string;
  /** 037 — De dónde viene (para «Por qué respondió así»). */
  groupId: string | null;
  agentId: string | null;
};

/**
 * 037 (PR 2) — Qué documentos puede leer el agente de `scope`, en SQL. Va
 * SIEMPRE dentro de `scoped(organización, …)`: la organización (y RLS) es la
 * primera barrera; esto es la segunda. La misma regla que `scopeAllows` de
 * `src/lib/kb-docs.ts`:
 *   (de la empresa Y (todos | su grupo está entre los elegidos)) O exclusivo de ESTE agente
 */
export function scopeCondition(scope: DocScope): SQL {
  const d = schema.kbDocument;
  const ofThisAgent = scope.agentId ? eq(d.agentId, scope.agentId) : sql`false`;
  if (scope.mode === "all") return or(isNull(d.agentId), ofThisAgent)!;
  const ids = scope.groupIds;
  const general = ids.includes(GENERAL_GROUP_KEY) ? isNull(d.groupId) : undefined;
  const named = ids.filter((id) => id !== GENERAL_GROUP_KEY);
  const inGroups = or(general, named.length > 0 ? inArray(d.groupId, named) : undefined);
  return or(inGroups ? and(isNull(d.agentId), inGroups) : undefined, ofThisAgent)!;
}

const hitColumns = () => ({
  id: schema.kbChunk.id,
  documentId: schema.kbChunk.documentId,
  title: schema.kbDocument.title,
  content: schema.kbChunk.content,
  groupId: schema.kbDocument.groupId,
  agentId: schema.kbDocument.agentId,
});

/** Búsqueda por texto (`tsquery` ya saneada por `lexicalQuery`), solo en lo que el agente puede leer. */
export async function lexicalSearch(organizationId: string, scope: DocScope, tsquery: string, limit: number): Promise<ChunkHit[]> {
  const c = schema.kbChunk;
  const d = schema.kbDocument;
  const q = sql`to_tsquery('spanish'::regconfig, ${tsquery})`;
  return getDb()
    .select(hitColumns())
    .from(schema.kbChunk)
    .innerJoin(schema.kbDocument, and(eq(d.organizationId, c.organizationId), eq(d.id, c.documentId)))
    .where(scoped(c.organizationId, organizationId, eq(d.status, "ready"), scopeCondition(scope), sql`${c.tsv} @@ ${q}`))
    .orderBy(sql`ts_rank_cd(${c.tsv}, ${q}) desc`, asc(c.id))
    .limit(limit);
}

/**
 * Firma barata de lo indexado (para la caché de vectores): cambia al subir,
 * borrar o reindexar cualquier documento. La caché es de TODA la
 * organización; qué puede leer cada agente se filtra en cada turno
 * (`allowedDocumentIds`).
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

/** ¿El agente tiene algún documento listo que leer? (atajo: sin documentos no se busca nada). */
export async function hasReadyDocuments(organizationId: string, scope: DocScope): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.kbDocument.id })
    .from(schema.kbDocument)
    .where(scoped(schema.kbDocument.organizationId, organizationId, eq(schema.kbDocument.status, "ready"), scopeCondition(scope)))
    .limit(1);
  return Boolean(row);
}

/** 037 — Los documentos listos que el agente puede leer (filtra la caché de vectores en cada turno). */
export async function allowedDocumentIds(organizationId: string, scope: DocScope): Promise<Set<string>> {
  const rows = await getDb()
    .select({ id: schema.kbDocument.id })
    .from(schema.kbDocument)
    .where(scoped(schema.kbDocument.organizationId, organizationId, eq(schema.kbDocument.status, "ready"), scopeCondition(scope)));
  return new Set(rows.map((r) => r.id));
}

/** Los vectores de la organización hechos con `model` (solo documentos listos), con su documento. */
export async function loadVectors(
  organizationId: string,
  model: string
): Promise<{ id: string; documentId: string; embedding: number[] }[]> {
  const c = schema.kbChunk;
  const d = schema.kbDocument;
  const rows = await getDb()
    .select({ id: c.id, documentId: c.documentId, embedding: c.embedding })
    .from(schema.kbChunk)
    .innerJoin(schema.kbDocument, and(eq(d.organizationId, c.organizationId), eq(d.id, c.documentId)))
    .where(scoped(c.organizationId, organizationId, eq(d.status, "ready"), eq(c.embeddingModel, model), isNotNull(c.embedding)));
  return rows.filter((r): r is { id: string; documentId: string; embedding: number[] } => Array.isArray(r.embedding));
}

/** Los fragmentos por id, solo si el agente puede leerlos (defensa en profundidad tras la caché). */
export async function chunksByIds(organizationId: string, scope: DocScope, ids: string[]): Promise<ChunkHit[]> {
  if (ids.length === 0) return [];
  const c = schema.kbChunk;
  const d = schema.kbDocument;
  return getDb()
    .select(hitColumns())
    .from(schema.kbChunk)
    .innerJoin(schema.kbDocument, and(eq(d.organizationId, c.organizationId), eq(d.id, c.documentId)))
    .where(scoped(c.organizationId, organizationId, inArray(c.id, ids), eq(d.status, "ready"), scopeCondition(scope)));
}
