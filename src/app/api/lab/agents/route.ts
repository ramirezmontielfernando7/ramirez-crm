import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { isAiConfigured } from "@/lib/env";
import { withAgentErrors } from "@/server/agents/http";
import { createAgent, getOrgAiEnabled, getOrgPause, listAgents, maxAgentsFor } from "@/server/agents/store";
import { orgWhatsAppConnected } from "@/server/onboarding";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/** 031 — Agentes de la organización (el general primero) con su última evaluación. */
export const GET = withAuth(async (session) => {
  const off = await moduleOff(session.organizationId, "agent");
  if (off) return off;
  const [agents, pause, maxAgents, aiEnabled, whatsappConnected] = await Promise.all([
    listAgents(session.organizationId),
    getOrgPause(session.organizationId),
    maxAgentsFor(session.organizationId),
    getOrgAiEnabled(session.organizationId),
    orgWhatsAppConnected(session.organizationId),
  ]);
  // Auditoría UX 2026-11 (B): el interruptor global y lo que falta para encenderlo.
  return Response.json({
    agents,
    maxAgents,
    aiConfigured: isAiConfigured(),
    orgPaused: pause.paused,
    aiEnabled,
    whatsappConnected,
  });
}, { permission: "agent.manage" });

const createSchema = z.object({
  internalName: z.string().trim().min(1).max(60),
  duplicateOf: z.string().min(1).optional(),
});

/** Crea un agente en borrador (o duplica uno: su borrador y su conocimiento propio). */
export const POST = withAuth(async (session, req: Request) => {
  const off = await moduleOff(session.organizationId, "agent");
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
