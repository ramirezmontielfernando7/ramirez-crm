import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { deleteKbEntry, updateKbEntry } from "@/server/agents/kb";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  question: z.string().trim().min(1).max(500).optional(),
  answer: z.string().trim().min(1).max(4000).optional(),
  content: z.string().trim().min(1).max(8000).optional(),
});

/**
 * 031 — `?agentId=` (opcional): la entrada debe ser de ese agente (vacío =
 * del compartido). Sin él, cualquier entrada de la organización, como antes.
 */
function ownerParam(req: Request): string | null | undefined {
  const params = new URL(req.url).searchParams;
  if (!params.has("agentId")) return undefined;
  return params.get("agentId") || null;
}

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const off = await moduleOff(session.organizationId, "agent");
  if (off) return off;
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const entry = await updateKbEntry(session.organizationId, id, body.data, ownerParam(req));
  if (!entry) return apiError(404, "not_found", "Entrada no encontrada");
  return Response.json({ entry });
}, { permission: "agent.manage" });

export const DELETE = withAuth(async (session, req: Request, ctx: Params) => {
  const off = await moduleOff(session.organizationId, "agent");
  if (off) return off;
  const { id } = await ctx.params;
  const deleted = await deleteKbEntry(session.organizationId, id, ownerParam(req));
  if (!deleted) return apiError(404, "not_found", "Entrada no encontrada");
  return Response.json({ deleted: true });
}, { permission: "agent.manage" });
