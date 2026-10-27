import { apiError, withAuth } from "@/lib/api";
import { conectorIaOff } from "@/server/modules";
import { revokeConnection } from "@/server/ai-connector/keys";

export const dynamic = "force-dynamic";

/** 047 PR 3 — «Desconectar»: la IA y todas sus llaves dejan de abrir al instante. Solo las propias. */
export const DELETE = withAuth(async (session, _req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const off = await conectorIaOff(session.organizationId);
  if (off) return off;
  const { id } = await ctx.params;
  if (!(await revokeConnection(session, id))) return apiError(404, "not_found", "No existe esa conexión");
  return new Response(null, { status: 204 });
});
