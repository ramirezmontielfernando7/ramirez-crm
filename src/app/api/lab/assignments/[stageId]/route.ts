import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { assignStage, unassignStage } from "@/server/agents/assignments";
import { withAgentErrors } from "@/server/agents/http";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ stageId: string }> };

const putSchema = z.object({
  agentId: z.string().min(1).max(64),
  /** La pantalla ya mostró quién la atendía y la persona confirmó el cambio. */
  replace: z.boolean().optional(),
});

/**
 * 031 (PR B) — Asigna un agente PUBLICADO a la etapa. Si ya la atiende otro:
 * 409 `stage_taken` con `current` (la pantalla pide confirmación y reintenta
 * con `replace: true`). Borrador → 409 `not_published`; general → 409
 * `agent_general`.
 */
export const PUT = withAuth(async (session, req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? (await moduleOff(session.organizationId, "agent"));
  if (off) return off;
  const { stageId } = await ctx.params;
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  return withAgentErrors(async () => {
    await assignStage(session.organizationId, {
      stageId,
      agentId: body.data.agentId,
      actorUserId: session.userId,
      replace: body.data.replace,
    });
    return Response.json({ assigned: true });
  });
}, { permission: "agent.manage" });

/** La etapa vuelve al agente general. Idempotente. */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? (await moduleOff(session.organizationId, "agent"));
  if (off) return off;
  const { stageId } = await ctx.params;
  await unassignStage(session.organizationId, stageId);
  return Response.json({ assigned: false });
}, { permission: "agent.manage" });
