import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { withAgentErrors } from "@/server/agents/http";
import { archiveAgent, getAgent, renameAgent } from "@/server/agents/store";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 031 — Un agente: borrador y publicado. */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? (await moduleOff(session.organizationId, "agent"));
  if (off) return off;
  const { id } = await ctx.params;
  const agent = await getAgent(session.organizationId, id);
  if (!agent) return apiError(404, "not_found", "Agente no encontrado");
  return Response.json({ agent });
}, { permission: "agent.manage" });

const patchSchema = z.object({ internalName: z.string().trim().min(1).max(60) });

/** Renombrar (nombre interno: solo lo ve el equipo). */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? (await moduleOff(session.organizationId, "agent"));
  if (off) return off;
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  return withAgentErrors(async () =>
    Response.json({ agent: await renameAgent(session.organizationId, id, body.data.internalName) })
  );
}, { permission: "agent.manage" });

/** Archivar. El general no se archiva (409 `agent_general`). */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? (await moduleOff(session.organizationId, "agent"));
  if (off) return off;
  const { id } = await ctx.params;
  return withAgentErrors(async () => {
    await archiveAgent(session.organizationId, id);
    return Response.json({ archived: true });
  });
}, { permission: "agent.manage" });
