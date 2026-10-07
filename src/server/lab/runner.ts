import { asc, eq } from "drizzle-orm";
import { runWithOrganization } from "@/lib/request-context";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import { publish } from "@/server/events/bus";
import { runAgentTurn } from "@/server/ai/pipeline";
import { behaviorText, toPromptConfig } from "@/server/agents/config";
import { buildRunSnapshot, type RunSnapshot, type RunSource } from "@/server/agents/snapshot";
import { computeScore, judgeCase } from "@/server/lab/judge";
import { PERSONAS, type Persona } from "@/server/lab/personas";
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
  opts: { agentId?: string; source?: RunSource } = {}
): Promise<string> {
  const db = getDb();
  const snapshot = await buildRunSnapshot(organizationId, opts);
  let runId: string;
  try {
    const inserted = await db
      .insert(schema.agentTestRun)
      .values({
        id: newId("testRun"),
        organizationId,
        status: "running",
        agentId: snapshot.agentId,
        agentSnapshot: snapshot,
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

  await db.insert(schema.agentTestCase).values(
    PERSONAS.map((p) => ({
      id: newId("testCase"),
      organizationId,
      runId,
      persona: p.key,
      status: "pending" as const,
    }))
  );

  // Fire-and-forget in-process: el POST regresa ya; el progreso va por SSE.
  // PR 3: la corrida entera va a nombre de su organización (sin transacción
  // abierta: cada caso llama al LLM varias veces).
  void runWithOrganization(organizationId, () =>
    executeRun(runId, organizationId, snapshot).catch(async (err) => {
      log.error("corrida falló", { org: organizationId, corrida: runId, err });
      await failRun(runId, organizationId, String(err));
    })
  );

  return runId;
}

async function executeRun(
  runId: string,
  organizationId: string,
  snapshot: RunSnapshot
): Promise<void> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("timeout de 10 minutos superado")),
      RUN_TIMEOUT_MS
    )
  );
  try {
    await Promise.race([runAllCases(runId, organizationId, snapshot), timeout]);
  } catch (err) {
    await failRun(runId, organizationId, String(err));
  }
}

async function runAllCases(
  runId: string,
  organizationId: string,
  snapshot: RunSnapshot
): Promise<void> {
  const db = getDb();
  const cases = await db
    .select()
    .from(schema.agentTestCase)
    .where(eq(schema.agentTestCase.runId, runId))
    .orderBy(asc(schema.agentTestCase.createdAt));

  // 031: el juez ve exactamente lo que se congeló al empezar.
  const kbText = snapshot.kbText;
  const behavior = behaviorText(toPromptConfig(snapshot.config));

  let done = 0;
  const total = cases.length;
  publishProgress(organizationId, runId, "running", done, total);

  for (const testCase of cases) {
    const persona = PERSONAS.find((p) => p.key === testCase.persona);
    if (!persona) continue;

    await db
      .update(schema.agentTestCase)
      .set({ status: "running" })
      .where(eq(schema.agentTestCase.id, testCase.id));

    const { transcript, conversationId } = await runConversation(
      organizationId,
      persona,
      snapshot
    );

    const outcome = await judgeCase({
      organizationId,
      personaKey: persona.key,
      transcript,
      kbText,
      behaviorText: behavior,
    });

    await db
      .update(schema.agentTestCase)
      .set({
        conversationId,
        transcript,
        status: outcome.status,
        veredicto: outcome.status === "done" ? outcome.verdict.veredicto : null,
        hallazgos: outcome.status === "done" ? outcome.verdict.hallazgos : null,
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

/** Conversa el guion completo contra el agente real; corta al primer handoff. */
async function runConversation(
  organizationId: string,
  persona: Persona,
  snapshot: RunSnapshot
): Promise<{
  transcript: { role: "cliente" | "agente"; text: string }[];
  conversationId: string;
}> {
  const db = getDb();

  // Contacto sintético ARCHIVADO (no aparece en la lista ni genera leads).
  const contactId = await upsertTestContact(organizationId, persona);

  const convId = newId("conversation");
  await db.insert(schema.conversation).values({
    id: convId,
    organizationId,
    contactId,
    isTest: true,
    aiEnabled: true,
  });

  for (const line of persona.script) {
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
    if (convRows[0]?.handoffAt) break; // primer handoff → fin del guion
  }

  const messages = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, convId))
    .orderBy(asc(schema.message.createdAt));

  return {
    conversationId: convId,
    transcript: messages
      .filter((m) => m.text)
      .map((m) => ({
        role: m.direction === "in" ? ("cliente" as const) : ("agente" as const),
        text: m.text!,
      })),
  };
}

async function upsertTestContact(
  organizationId: string,
  persona: Persona
): Promise<string> {
  const db = getDb();
  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      phone: persona.phone,
      waIdentity: persona.phone,
      name: persona.contactName,
      archivedAt: new Date(),
    })
    // Ídem que en el alta manual: desde 014 el índice único incluye `channel`,
    // y un ON CONFLICT que no lo nombra no corresponde a ningún índice. Sin
    // esto, TODA corrida del Laboratorio muere antes de la primera persona.
    .onConflictDoNothing({
      target: [
        schema.contact.organizationId,
        schema.contact.channel,
        schema.contact.waIdentity,
      ],
    })
    .returning();
  if (inserted[0]) return inserted[0].id;
  const rows = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      scoped(schema.contact.organizationId, organizationId,
        eq(schema.contact.phone, persona.phone)
      )
    )
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
  publishProgress(organizationId, runId, "failed", 0, PERSONAS.length);
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
