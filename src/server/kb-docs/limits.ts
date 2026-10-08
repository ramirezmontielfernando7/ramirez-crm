import { getDb, schema, type Db } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";

/**
 * 035 — Los límites de documentos de una organización: los propios
 * (`kb_document_limit`, los fija el operador con scripts/kb-limits.mjs) o, si
 * no tiene (o vale NULL), los del entorno.
 */
export type KbDocLimits = { maxFileBytes: number; maxDocuments: number; maxChunks: number };

export function envKbDocLimits(): KbDocLimits {
  const env = getEnv();
  return {
    maxFileBytes: Math.round(env.KB_DOCS_MAX_FILE_MB * 1024 * 1024),
    maxDocuments: env.KB_DOCS_MAX_DOCUMENTS,
    maxChunks: env.KB_DOCS_MAX_CHUNKS,
  };
}

export async function getKbDocLimits(organizationId: string, db: Db = getDb()): Promise<KbDocLimits> {
  const [row] = await db
    .select()
    .from(schema.kbDocumentLimit)
    .where(scoped(schema.kbDocumentLimit.organizationId, organizationId))
    .limit(1);
  const def = envKbDocLimits();
  return {
    maxFileBytes: row?.maxFileBytes ?? def.maxFileBytes,
    maxDocuments: row?.maxDocuments ?? def.maxDocuments,
    maxChunks: row?.maxChunks ?? def.maxChunks,
  };
}

/** «5 MB», «512 KB»: el límite en palabras para el mensaje de error. */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
