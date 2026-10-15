import type { KnowledgeEntryDto } from "@/lib/knowledge";
import { documentsByEntries } from "@/server/kb-docs/store";
import { serializeKnowledge, type KnowledgeRow } from "@/server/knowledge/store";
import { ragAvailable } from "./bridge";

/**
 * 040 — Las entradas de la Biblioteca con su «🤖 Lectura IA (RAG)» (el
 * documento del agente que sale de cada una). Sin Documentos del agente en
 * la organización, `rag` es siempre `null` y no se consulta nada más.
 */
export async function withRag(organizationId: string, rows: KnowledgeRow[]): Promise<KnowledgeEntryDto[]> {
  const docs = (await ragAvailable(organizationId))
    ? await documentsByEntries(organizationId, rows.map((r) => r.id))
    : new Map();
  return rows.map((r) => {
    const doc = docs.get(r.id);
    return {
      ...serializeKnowledge(r),
      rag: doc ? { documentId: doc.id, status: doc.status, groupId: doc.groupId } : null,
    };
  });
}
