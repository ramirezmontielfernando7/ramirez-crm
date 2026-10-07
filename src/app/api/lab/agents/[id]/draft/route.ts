import { parseBody, withAuth } from "@/lib/api";
import { agentConfigSchema, type AgentConfig } from "@/server/agents/config";
import { withAgentErrors } from "@/server/agents/http";
import { saveDraft } from "@/server/agents/store";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 031 — Guarda el BORRADOR. Producción no cambia hasta publicar. */
export const PUT = withAuth(async (session, req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? (await moduleOff(session.organizationId, "agent"));
  if (off) return off;
  const { id } = await ctx.params;
  const body = await parseBody(req, agentConfigSchema);
  if (!body.ok) return body.response;
  return withAgentErrors(async () =>
    Response.json({ agent: await saveDraft(session.organizationId, id, body.data as AgentConfig) })
  );
}, { permission: "agent.manage" });
