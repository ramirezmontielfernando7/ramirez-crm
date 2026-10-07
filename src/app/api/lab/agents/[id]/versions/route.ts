import { apiError, withAuth } from "@/lib/api";
import { listVersions } from "@/server/agents/store";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 031 — Historial de versiones de un agente (últimas 30). */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? (await moduleOff(session.organizationId, "agent"));
  if (off) return off;
  const { id } = await ctx.params;
  const versions = await listVersions(session.organizationId, id);
  if (!versions) return apiError(404, "not_found", "Agente no encontrado");
  return Response.json({ versions });
}, { permission: "agent.manage" });
