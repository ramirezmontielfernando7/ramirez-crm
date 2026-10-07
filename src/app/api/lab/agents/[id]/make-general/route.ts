import { withAuth } from "@/lib/api";
import { withAgentErrors } from "@/server/agents/http";
import { makeGeneral } from "@/server/agents/store";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 031 — Hace general a un agente publicado (409 `not_published` si no lo está). */
export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? (await moduleOff(session.organizationId, "agent"));
  if (off) return off;
  const { id } = await ctx.params;
  return withAgentErrors(async () =>
    Response.json({ agent: await makeGeneral(session.organizationId, id, session.userId) })
  );
}, { permission: "agent.manage" });
