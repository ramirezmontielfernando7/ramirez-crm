import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { isAiConfigured } from "@/lib/env";
import { withAgentErrors } from "@/server/agents/http";
import { createAgent, listAgents, MAX_ACTIVE_AGENTS } from "@/server/agents/store";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/** 031 — Agentes de la organización (el general primero) con su última evaluación. */
export const GET = withAuth(async (session) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? (await moduleOff(session.organizationId, "agent"));
  if (off) return off;
  const agents = await listAgents(session.organizationId);
  return Response.json({ agents, maxAgents: MAX_ACTIVE_AGENTS, aiConfigured: isAiConfigured() });
}, { permission: "agent.manage" });

const createSchema = z.object({
  internalName: z.string().trim().min(1).max(60),
  duplicateOf: z.string().min(1).optional(),
});

/** Crea un agente en borrador (o duplica uno: su borrador y su conocimiento propio). */
export const POST = withAuth(async (session, req: Request) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? (await moduleOff(session.organizationId, "agent"));
  if (off) return off;
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;
  return withAgentErrors(async () => {
    const agent = await createAgent({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      internalName: body.data.internalName,
      duplicateOf: body.data.duplicateOf,
    });
    return Response.json({ agent }, { status: 201 });
  });
}, { permission: "agent.manage" });
