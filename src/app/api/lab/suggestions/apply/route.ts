import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { moduleOff } from "@/server/modules";
import { createKbEntry } from "@/server/agents/kb";
import { withAgentErrors } from "@/server/agents/http";

export const dynamic = "force-dynamic";

/**
 * Aplica una sugerencia del juez con un click: crea la entrada P/R en el
 * knowledge base (FR-033). El front permite editarla antes de guardar; aquí
 * llega el texto final.
 */
const bodySchema = z.object({
  caseId: z.string().min(1),
  hallazgoIndex: z.number().int().min(0),
  pregunta: z.string().trim().min(1).max(500),
  respuesta: z.string().trim().min(1).max(4000),
  /** 031 — A qué conocimiento va: `null`/ausente = compartido; un id = de ese agente. */
  agentId: z.string().min(1).nullable().optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  const off = await moduleOff(session.organizationId, "lab");
  if (off) return off;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const cases = await db
    .select({ id: schema.agentTestCase.id })
    .from(schema.agentTestCase)
    .where(
      scoped(
        schema.agentTestCase.organizationId,
        session.organizationId,
        eq(schema.agentTestCase.id, body.data.caseId)
      )
    )
    .limit(1);
  if (!cases[0]) return apiError(404, "not_found", "Caso no encontrado");

  return withAgentErrors(async () => {
    const entry = await createKbEntry(session.organizationId, {
      kind: "qa",
      question: body.data.pregunta,
      answer: body.data.respuesta,
      agentId: body.data.agentId ?? null,
    });
    return Response.json({ entry }, { status: 201 });
  });
}, { permission: "agent.manage" });
