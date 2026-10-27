import { z } from "zod";
import { ASSISTANT_NAME_MAX } from "@/lib/ai-connector";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { conectorIaOff } from "@/server/modules";
import { renameAssistant, revokeConnection } from "@/server/ai-connector/keys";

export const dynamic = "force-dynamic";

/** 047 PR 3 — «Desconectar»: la IA y todas sus llaves dejan de abrir al instante. Solo las propias. */
export const DELETE = withAuth(async (session, _req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const off = await conectorIaOff(session.organizationId);
  if (off) return off;
  const { id } = await ctx.params;
  if (!(await revokeConnection(session, id))) return apiError(404, "not_found", "No existe esa conexión");
  return new Response(null, { status: 204 });
});

const patchSchema = z.object({ assistantName: z.string().max(ASSISTANT_NAME_MAX).nullable() });

/** «Ponle nombre»: cómo firma esta IA en la Bandeja («Joe»); vacío o null = «Asistente». Solo las propias. */
export const PATCH = withAuth(async (session, req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const off = await conectorIaOff(session.organizationId);
  if (off) return off;
  const { id } = await ctx.params;
  const parsed = await parseBody(req, patchSchema);
  if (!parsed.ok) return parsed.response;
  if (!(await renameAssistant(session, id, parsed.data.assistantName))) {
    return apiError(404, "not_found", "No existe esa conexión");
  }
  return new Response(null, { status: 204 });
});
