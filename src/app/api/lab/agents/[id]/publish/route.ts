import { withAuth } from "@/lib/api";
import { withAgentErrors } from "@/server/agents/http";
import { publishAgent } from "@/server/agents/store";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 031 — Publica el borrador: pasa a producción y queda en el historial (y,
 * si es el general, en `agent_profile`), en una transacción.
 */
export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? (await moduleOff(session.organizationId, "agent"));
  if (off) return off;
  const { id } = await ctx.params;
  return withAgentErrors(async () =>
    Response.json({ agent: await publishAgent(session.organizationId, id, session.userId) })
  );
}, { permission: "agent.manage" });
