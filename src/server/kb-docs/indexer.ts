import { chunkText } from "@/lib/kb-docs";
import { logger } from "@/lib/log";
import { runWithOrganization } from "@/lib/request-context";
import { currentEmbeddingModel, embedForOrg } from "@/server/ai-quota/embed";
import { isOrgActive } from "@/server/platform-admin/org-status";
import { kbDocsEnabled } from "./flag";
import {
  claimDocument,
  documentsToResume,
  failDocument,
  getDocument,
  KbDocError,
  listChunks,
  markReady,
  replaceChunks,
  saveEmbeddings,
} from "./store";

/**
 * 035 — Indexado de documentos, IN-PROCESS (sin colas externas, como el
 * agente y el Laboratorio). Un documento a la vez por organización y dos en
 * total: un manual grande de un negocio no frena a los demás ni satura la CPU
 * que comparten la app, Postgres y el contenedor de embeddings.
 *
 * Pasos: fragmentar → guardar fragmentos → pedir vectores en lotes (si hay
 * servicio) → «Listo». Si los vectores fallan, el documento queda «Listo
 * (solo texto)» (se busca por texto) y el arranque siguiente lo vuelve a
 * intentar. Todo lo que llama al servicio va FUERA de transacción.
 */

const log = logger("kb-docs");

const MAX_GLOBAL = 2;
/** Fragmentos por llamada a `embedForOrg` (que a su vez parte en lotes de 32). */
const EMBED_STEP = 64;

type Job = { organizationId: string; id: string };

const g = globalThis as unknown as {
  __voceroKbIndexer?: {
    queue: Job[];
    running: Set<string>;
    busyOrgs: Set<string>;
    /** Pedidos de reindexar que llegaron mientras ese documento se indexaba. */
    rerun: Set<string>;
    idle: (() => void)[];
  };
};
function state() {
  return (g.__voceroKbIndexer ??= { queue: [], running: new Set(), busyOrgs: new Set(), rerun: new Set(), idle: [] });
}

/**
 * Pone un documento en la cola (idempotente: si ya está, no se repite). Si se
 * está indexando ahora mismo, vuelve a la cola al terminar.
 */
export function scheduleIndex(organizationId: string, id: string): void {
  const s = state();
  if (s.running.has(id)) {
    s.rerun.add(id);
    return;
  }
  if (s.queue.some((j) => j.id === id)) return;
  s.queue.push({ organizationId, id });
  pump();
}

function pump(): void {
  const s = state();
  while (s.running.size < MAX_GLOBAL) {
    const i = s.queue.findIndex((j) => !s.busyOrgs.has(j.organizationId));
    if (i === -1) break;
    const job = s.queue.splice(i, 1)[0]!;
    s.running.add(job.id);
    s.busyOrgs.add(job.organizationId);
    void runWithOrganization(job.organizationId, () => indexDocument(job.organizationId, job.id))
      .catch((err) => log.error("falló el indexado de un documento", { org: job.organizationId, doc: job.id, err }))
      .finally(() => {
        s.running.delete(job.id);
        s.busyOrgs.delete(job.organizationId);
        if (s.rerun.delete(job.id)) s.queue.push(job);
        pump();
        if (s.running.size === 0 && s.queue.length === 0) s.idle.splice(0).forEach((r) => r());
      });
  }
}

/** Solo pruebas y E2E: espera a que la cola se vacíe. */
export function whenIndexerIdle(): Promise<void> {
  const s = state();
  if (s.running.size === 0 && s.queue.length === 0) return Promise.resolve();
  return new Promise((r) => s.idle.push(r));
}

/** Indexa (o completa los vectores de) UN documento, a nombre de su organización. */
export async function indexDocument(organizationId: string, id: string): Promise<void> {
  // Una organización suspendida no gasta servidor: se queda en cola hasta el próximo arranque.
  if (!(await isOrgActive(organizationId))) return;
  const current = await getDocument(organizationId, id);
  if (!current) return;

  const model = currentEmbeddingModel();
  const soloVectores = current.status === "ready" && current.chunkCount > 0;
  if (!soloVectores) {
    const doc = await claimDocument(organizationId, id);
    if (!doc) return;
    const contents = chunkText(doc.text);
    if (contents.length === 0) {
      await failDocument(organizationId, id, "empty");
      return;
    }
    try {
      await replaceChunks(organizationId, id, contents, { final: !model });
    } catch (err) {
      const code = err instanceof KbDocError ? err.code : "internal";
      if (code === "internal") log.error("no se pudieron guardar los fragmentos", { doc: id, err });
      await failDocument(organizationId, id, code);
      return;
    }
  }
  if (!model) return;
  try {
    await embedMissing(organizationId, id, model);
  } finally {
    // Con o sin vectores, el documento ya se busca (por texto como mínimo).
    if (!soloVectores) await markReady(organizationId, id);
  }
}

async function embedMissing(organizationId: string, id: string, model: string): Promise<void> {
  const chunks = (await listChunks(organizationId, id)).filter((c) => c.embeddingModel !== model);
  if (chunks.length === 0) return;
  const done: { id: string; embedding: Float32Array }[] = [];
  for (let i = 0; i < chunks.length; i += EMBED_STEP) {
    const step = chunks.slice(i, i + EMBED_STEP);
    const r = await embedForOrg(organizationId, "passage", step.map((c) => c.content), { timeoutMs: 120_000 });
    if (!r.ok) {
      // Se queda en «solo texto»: la búsqueda por texto ya funciona. El
      // próximo arranque lo vuelve a intentar.
      log.warn("sin vectores para un documento: queda con búsqueda por texto", { doc: id, error: r.error });
      return;
    }
    step.forEach((c, j) => done.push({ id: c.id, embedding: r.vectors[j]! }));
  }
  await saveEmbeddings(organizationId, id, model, done);
}

/**
 * Al arrancar: retoma lo que quedó a medias (en cola, indexando, o listo sin
 * vectores del modelo actual). No frena el arranque ni lo tumba.
 */
export async function resumeKbIndexing(): Promise<void> {
  if (!kbDocsEnabled()) return;
  try {
    const docs = await documentsToResume(currentEmbeddingModel());
    for (const d of docs) scheduleIndex(d.organizationId, d.id);
    if (docs.length > 0) log.info("documentos del agente retomados al arrancar", { cantidad: docs.length });
  } catch (err) {
    log.error("no se pudo retomar el indexado de documentos", { err });
  }
}
