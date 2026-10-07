import { withAuth } from "@/lib/api";
import { withAgentErrors } from "@/server/agents/http";
import { restoreVersion } from "@/server/agents/store";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; logId: string }> };

/** 031 (D8) — Carga una versión al BORRADOR; nunca a producción. */
export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? (await moduleOff(session.organizationId, "agent"));
  if (off) return off;
  const { id, logId } = await ctx.params;
  return withAgentErrors(async () =>
    Response.json({ agent: await restoreVersion(session.organizationId, id, logId, session.userId) })
  );
}, { permission: "agent.manage" });
