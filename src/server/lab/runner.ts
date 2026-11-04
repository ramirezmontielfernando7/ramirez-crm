import { and, asc, eq } from "drizzle-orm";
import { runWithOrganization } from "@/lib/request-context";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import { publish } from "@/server/events/bus";
import { runAgentTurn } from "@/server/ai/pipeline";
import { buildRunSnapshot, type RunSnapshot, type RunSource } from "@/server/agents/snapshot";
import {
  clientsOf,
  computeScore,
  generateClients,
  nextClientMessage,
  reviewConversation,
  SIM_DEFAULT_COUNT,
  SIM_MAX_CLIENT_MESSAGES,
  type SimClient,
  type Transcript,
} from "@/server/lab/simulated";
import { logger } from "@/lib/log";

const log = logger("lab");

/**
 * Runner del Laboratorio (FR-030/FR-034): corrida en segundo plano DENTRO del
 * proceso (sin cola externa), turnos secuenciales con debounce 0, timeout
 * global de 10 minutos, y lock de concurrencia por índice parcial UNIQUE en
 * BD (máx. 1 corrida `running` por organización).
 *
 * Sandbox (FR-031): las conversaciones se crean con is_test=true; el pipeline
 * del agente persiste las respuestas sin tocar la API, y el sender real lanza
 * si algo intenta enviarlas.
 *
 * 0070: los clientes ya no son 6 personas fijas: se INVENTAN con lo que sabe
 * el agente (`simulated.ts`), conversan según lo que responde el agente y una
 * revisión por conversación dice Bien / Revisar / Falló. Los clientes quedan
 * en `agent_snapshot.clients` (sin migración); `persona` del caso es su clave.
 */

const RUN_TIMEOUT_MS = 10 * 60 * 1000;

export class RunConflictError extends Error {}

/**
 * 031: `agentId` (default: el general) y `source` (default: lo publicado).
 * Lo que se evalúa se congela aquí, antes de empezar, en `agent_snapshot`.
 * Un agente inexistente o sin publicar lanza `AgentError` (la ruta responde).
 */
export async function startRun(
  organizationId: string,
  opts: { agentId?: string; source?: RunSource; clients?: number; repeat?: { runId: string; caseId: string } } = {}
): Promise<string> {
  const db = getDb();
  const snapshot = await buildRunSnapshot(organizationId, opts);
  // «Repetir con este cliente»: el mismo cliente de una prueba anterior, sin inventar otros.
  const preset = opts.repeat ? await clientOfCase(organizationId, opts.repeat.runId, opts.repeat.caseId) : null;
  if (opts.repeat && !preset) throw new RunNotFoundError("Ese cliente ya no existe");
  let runId: string;
  try {
    const inserted = await db
      .insert(schema.agentTestRun)
      .values({
        id: newId("testRun"),
        organizationId,
        status: "running",
        agentId: snapshot.agentId,
        agentSnapshot: { ...snapshot, clients: preset ? [{ ...preset, key: "sim_1" }] : [] },
      })
      .returning();
    runId = inserted[0]!.id;
  } catch (err) {
    // Violación del índice parcial UNIQUE → ya hay una corrida activa.
    if (isUniqueViolation(err)) {
      throw new RunConflictError("Ya hay una corrida en curso");
    }
    throw err;
  }

  const count = preset ? 1 : (opts.clients ?? SIM_DEFAULT_COUNT);
  // Fire-and-forget in-process: el POST regresa ya; el progreso va por SSE.
  // PR 3: la corrida entera va a nombre de su organización (sin transacción
  // abierta: cada caso llama al LLM varias veces).
  void runWithOrganization(organizationId, () =>
    executeRun(runId, organizationId, snapshot, preset ? [{ ...preset, key: "sim_1" }] : null, count).catch(async (err) => {
      log.error("corrida falló", { org: organizationId, corrida: runId, err });
      await failRun(runId, organizationId, String(err));
    })
  );

  return runId;
}

export class RunNotFoundError extends Error {}

async function clientOfCase(organizationId: string, runId: string, caseId: string): Promise<SimClient | null> {
  const db = getDb();
  const [run] = await db
    .select({ snapshot: schema.agentTestRun.agentSnapshot })
    .from(schema.agentTestRun)
    .where(scoped(schema.agentTestRun.organizationId, organizationId, eq(schema.agentTestRun.id, runId)))
    .limit(1);
  const [c] = await db
    .select({ persona: schema.agentTestCase.persona })
    .from(schema.agentTestCase)
    .where(scoped(schema.agentTestCase.organizationId, organizationId, and(eq(schema.agentTestCase.id, caseId), eq(schema.agentTestCase.runId, runId))))
    .limit(1);
  if (!run || !c) return null;
  return clientsOf(run.snapshot).find((x) => x.key === c.persona) ?? null;
}

async function executeRun(
  runId: string,
  organizationId: string,
  snapshot: RunSnapshot,
  preset: SimClient[] | null,
  count: number
): Promise<void> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("timeout de 10 minutos superado")),
      RUN_TIMEOUT_MS
    )
  );
  try {
    await Promise.race([runAllCases(runId, organizationId, snapshot, preset, count), timeout]);
  } catch (err) {
    await failRun(runId, organizationId, String(err));
  }
}

async function runAllCases(
  runId: string,
  organizationId: string,
  snapshot: RunSnapshot,
  preset: SimClient[] | null,
  count: number
): Promise<void> {
  const db = getDb();
  publishProgress(organizationId, runId, "running", 0, count);

  // 1. Los clientes: inventados con lo que sabe el agente (o el que se repite).
  const clients = preset ?? (await generateClients(organizationId, snapshot, count));
  await db
    .update(schema.agentTestRun)
    .set({ agentSnapshot: { ...snapshot, clients } })
    .where(eq(schema.agentTestRun.id, runId));
  const cases = await db
    .insert(schema.agentTestCase)
    .values(clients.map((c) => ({ id: newId("testCase"), organizationId, runId, persona: c.key, status: "pending" as const })))
    .returning();

  let done = 0;
  const total = cases.length;
  publishProgress(organizationId, runId, "running", done, total);

  for (const testCase of cases) {
    const client = clients.find((c) => c.key === testCase.persona);
    if (!client) continue;

    await db
      .update(schema.agentTestCase)
      .set({ status: "running" })
      .where(eq(schema.agentTestCase.id, testCase.id));

    const { transcript, conversationId, handedOff } = await runConversation(organizationId, client, clients.indexOf(client), snapshot);

    // 2. Una revisión por conversación.
    const outcome = await reviewConversation({ organizationId, snapshot, client, transcript, handedOff });

    await db
      .update(schema.agentTestCase)
      .set({
        conversationId,
        transcript,
        status: outcome.status,
        veredicto: outcome.status === "done" ? outcome.veredicto : null,
        hallazgos: outcome.status === "done" ? outcome.review : null,
      })
      .where(eq(schema.agentTestCase.id, testCase.id));

    done += 1;
    publishProgress(organizationId, runId, "running", done, total);
  }

  const finalCases = await db
    .select({
      status: schema.agentTestCase.status,
      veredicto: schema.agentTestCase.veredicto,
    })
    .from(schema.agentTestCase)
    .where(eq(schema.agentTestCase.runId, runId));
  const score = computeScore(finalCases);

  await getDb()
    .update(schema.agentTestRun)
    .set({ status: "done", score, finishedAt: new Date() })
    .where(eq(schema.agentTestRun.id, runId));
  publishProgress(organizationId, runId, "done", done, total, score);
}

/**
 * El cliente conversa con el agente REAL (hasta 4 mensajes suyos); corta al
 * primer traspaso a una persona o cuando el cliente da por terminada la plática.
 */
async function runConversation(
  organizationId: string,
  client: SimClient,
  index: number,
  snapshot: RunSnapshot
): Promise<{ transcript: Transcript; conversationId: string; handedOff: boolean }> {
  const db = getDb();

  // Contacto sintético ARCHIVADO (no aparece en la lista ni genera leads).
  const contactId = await upsertTestContact(organizationId, index);

  const convId = newId("conversation");
  await db.insert(schema.conversation).values({
    id: convId,
    organizationId,
    contactId,
    isTest: true,
    aiEnabled: true,
  });

  const readTranscript = async (): Promise<Transcript> => {
    const messages = await db
      .select()
      .from(schema.message)
      .where(eq(schema.message.conversationId, convId))
      .orderBy(asc(schema.message.createdAt));
    return messages
      .filter((m) => m.text)
      .map((m) => ({ role: m.direction === "in" ? ("cliente" as const) : ("agente" as const), text: m.text! }));
  };

  let line: string | null = client.firstMessage;
  let handedOff = false;
  for (let i = 0; i < SIM_MAX_CLIENT_MESSAGES && line; i++) {
    const now = new Date();
    await db.insert(schema.message).values({
      id: newId("message"),
      organizationId,
      conversationId: convId,
      direction: "in",
      type: "text",
      text: line,
      status: "delivered",
      waTimestamp: now,
    });
    await db
      .update(schema.conversation)
      .set({ lastInboundAt: now, lastMessageAt: now, updatedAt: now })
      .where(eq(schema.conversation.id, convId));

    // Turno REAL del agente, secuencial y sin debounce (FR-030), con la
    // config y el conocimiento del snapshot (031).
    await runAgentTurn(convId, {
      agentOverride: { agentId: snapshot.agentId, config: snapshot.config, kb: snapshot.kb },
    });

    const convRows = await db
      .select({ handoffAt: schema.conversation.handoffAt })
      .from(schema.conversation)
      .where(eq(schema.conversation.id, convId))
      .limit(1);
    if (convRows[0]?.handoffAt) {
      handedOff = true;
      break;
    }
    if (i + 1 < SIM_MAX_CLIENT_MESSAGES) line = await nextClientMessage(organizationId, snapshot.agentId, client, await readTranscript());
  }

  return { conversationId: convId, transcript: await readTranscript(), handedOff };
}

async function upsertTestContact(organizationId: string, index: number): Promise<string> {
  const db = getDb();
  // Teléfono sintético estable por posición (jamás un número real).
  const phone = `52100000001${String(index + 1).padStart(2, "0")}`;
  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      phone,
      waIdentity: phone,
      name: `[Prueba] Cliente simulado ${index + 1}`,
      archivedAt: new Date(),
    })
    // Ídem que en el alta manual: desde 014 el índice único incluye `channel`,
    // y un ON CONFLICT que no lo nombra no corresponde a ningún índice.
    .onConflictDoNothing({
      target: [schema.contact.organizationId, schema.contact.channel, schema.contact.waIdentity],
    })
    .returning();
  if (inserted[0]) return inserted[0].id;
  const rows = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.phone, phone)))
    .limit(1);
  return rows[0]!.id;
}

async function failRun(
  runId: string,
  organizationId: string,
  error: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.agentTestRun)
    .set({ status: "failed", error, finishedAt: new Date() })
    .where(eq(schema.agentTestRun.id, runId));
  publishProgress(organizationId, runId, "failed", 0, 0);
}

function publishProgress(
  organizationId: string,
  runId: string,
  status: string,
  done: number,
  total: number,
  score?: number | null
): void {
  publish(organizationId, {
    type: "lab.run",
    data: { runId, status, progress: { done, total }, score },
  });
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "23505" || e.cause?.code === "23505";
}
