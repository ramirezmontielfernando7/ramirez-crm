import { asc, eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { clientsOf, LEGACY_PERSONA_LABELS } from "@/server/lab/simulated";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const off = await moduleOff(session.organizationId, "lab");
  if (off) return off;
  const { id } = await ctx.params;
  const db = getDb();
  const runs = await db
    .select()
    .from(schema.agentTestRun)
    .where(
      scoped(
        schema.agentTestRun.organizationId,
        session.organizationId,
        eq(schema.agentTestRun.id, id)
      )
    )
    .limit(1);
  const run = runs[0];
  if (!run) return apiError(404, "not_found", "Corrida no encontrada");

  const cases = await db
    .select()
    .from(schema.agentTestCase)
    .where(scoped(schema.agentTestCase.organizationId, session.organizationId, eq(schema.agentTestCase.runId, id)))
    .orderBy(asc(schema.agentTestCase.createdAt));

  const clients = new Map(clientsOf(run.agentSnapshot).map((c) => [c.key, c]));
  return Response.json({
    run: {
      id: run.id,
      status: run.status,
      score: run.score,
      error: run.error,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      agentId: run.agentId,
    },
    cases: cases.map((c) => ({
      id: c.id,
      persona: c.persona,
      personaLabel: clients.get(c.persona)?.label ?? LEGACY_PERSONA_LABELS[c.persona] ?? c.persona,
      // 0070: qué quería el cliente simulado (las corridas viejas no lo traen).
      summary: clients.get(c.persona)?.summary ?? null,
      status: c.status,
      veredicto: c.veredicto,
      hallazgos: c.hallazgos ?? [],
      transcript: c.transcript ?? [],
    })),
  });
}, { permission: "agent.manage" });
