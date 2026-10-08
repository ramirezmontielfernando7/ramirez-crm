import { getEnv } from "@/lib/env";
import { CANDIDATES, dot, fuseRrf, lexicalQuery, queryFromHistory, takeWithinBudget } from "@/lib/kb-docs";
import { logger } from "@/lib/log";
import { currentEmbeddingModel, embedForOrg } from "@/server/ai-quota/embed";
import { orgHasKbDocs } from "./flag";
import { chunksByIds, hasReadyDocuments, indexSignature, lexicalSearch, loadVectors, type ChunkHit } from "./store";

/**
 * 035 — Los fragmentos de documentos que ve el agente en ESTE turno.
 *
 * 1. Sin documentos (o la instancia/organización sin la función): `[]`, y el
 *    prompt queda idéntico al de antes.
 * 2. Búsqueda por texto (`tsvector` en español, siempre disponible).
 * 3. Si hay vectores del modelo actual: la consulta se embebe («query: …»,
 *    3 s como máximo) y se compara por coseno con umbral. Si el servicio
 *    falla, solo cuenta la búsqueda por texto: el turno nunca se cae por esto.
 * 4. Se fusionan las dos listas (RRF) y se toman hasta 4 fragmentos / 4 000
 *    caracteres.
 *
 * Fuera de transacción (llama al servicio de embeddings). Nunca lanza.
 */

const log = logger("kb-docs");

export type RetrievedChunk = ChunkHit;

/** Tiempo máximo para embeber la pregunta: el cliente está esperando respuesta. */
const QUERY_TIMEOUT_MS = 3000;
/** Organizaciones con vectores en memoria (≈ 4,6 MB cada una con 3 000 × 384). */
const CACHE_MAX_ORGS = 24;

type CacheEntry = { signature: string; model: string; ids: string[]; vectors: Float32Array[] };
const g = globalThis as unknown as { __voceroKbVectors?: Map<string, CacheEntry> };
const cache = () => (g.__voceroKbVectors ??= new Map());

/** Solo pruebas. */
export function forgetKbVectorCache(): void {
  cache().clear();
}

async function vectorsFor(organizationId: string, model: string): Promise<CacheEntry> {
  const signature = await indexSignature(organizationId);
  const hit = cache().get(organizationId);
  if (hit && hit.signature === signature && hit.model === model) {
    // LRU: lo recién usado al final.
    cache().delete(organizationId);
    cache().set(organizationId, hit);
    return hit;
  }
  const rows = await loadVectors(organizationId, model);
  const entry: CacheEntry = {
    signature,
    model,
    ids: rows.map((r) => r.id),
    vectors: rows.map((r) => Float32Array.from(r.embedding)),
  };
  cache().delete(organizationId);
  cache().set(organizationId, entry);
  while (cache().size > CACHE_MAX_ORGS) cache().delete(cache().keys().next().value!);
  return entry;
}

async function vectorCandidates(organizationId: string, query: string): Promise<string[]> {
  const model = currentEmbeddingModel();
  if (!model) return [];
  const entry = await vectorsFor(organizationId, model);
  if (entry.ids.length === 0) return [];
  const r = await embedForOrg(organizationId, "query", [query], { timeoutMs: QUERY_TIMEOUT_MS });
  if (!r.ok) {
    log.warn("sin embedding de la pregunta: solo búsqueda por texto", { error: r.error });
    return [];
  }
  const q = r.vectors[0]!;
  const min = getEnv().KB_DOCS_MIN_SIMILARITY;
  const scored: { id: string; s: number }[] = [];
  for (let i = 0; i < entry.ids.length; i++) {
    const s = dot(q, entry.vectors[i]!);
    if (s >= min) scored.push({ id: entry.ids[i]!, s });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, CANDIDATES).map((x) => x.id);
}

/** Recupera para una consulta ya armada. */
export async function retrieveChunks(organizationId: string, query: string): Promise<RetrievedChunk[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    if (!(await orgHasKbDocs(organizationId))) return [];
    if (!(await hasReadyDocuments(organizationId))) return [];
    const tsq = lexicalQuery(q);
    const [lexical, vector] = await Promise.all([
      tsq ? lexicalSearch(organizationId, tsq, CANDIDATES) : Promise.resolve([] as ChunkHit[]),
      vectorCandidates(organizationId, q).catch((err) => {
        log.warn("falló la búsqueda por similitud: solo búsqueda por texto", { err });
        return [] as string[];
      }),
    ]);
    const order = fuseRrf([lexical.map((h) => h.id), vector]);
    if (order.length === 0) return [];
    const known = new Map(lexical.map((h) => [h.id, h]));
    const missing = order.filter((id) => !known.has(id));
    for (const h of await chunksByIds(organizationId, missing)) known.set(h.id, h);
    const ranked = order.map((id) => known.get(id)).filter((h): h is ChunkHit => Boolean(h));
    return takeWithinBudget(ranked);
  } catch (err) {
    // Un problema con los documentos jamás deja al cliente sin respuesta.
    log.error("no se pudieron recuperar documentos; el turno sigue sin ellos", { err });
    return [];
  }
}

/** Recupera para un turno, a partir de su historial (los últimos mensajes del cliente). */
export async function retrieveForTurn(
  organizationId: string,
  history: { role: "user" | "assistant"; content: string }[]
): Promise<RetrievedChunk[]> {
  return retrieveChunks(organizationId, queryFromHistory(history));
}
