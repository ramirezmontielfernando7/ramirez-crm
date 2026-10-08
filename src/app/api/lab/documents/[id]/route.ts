import { apiError, withAuth } from "@/lib/api";
import { kbDocsOff } from "@/server/kb-docs/flag";
import { documentView } from "@/server/kb-docs/http";
import { deleteDocument, getDocument } from "@/server/kb-docs/store";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 035 — Un documento (la pantalla consulta su estado mientras se indexa). */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? kbDocsOff();
  if (off) return off;
  const { id } = await ctx.params;
  const doc = await getDocument(session.organizationId, id);
  if (!doc) return apiError(404, "not_found", "Documento no encontrado");
  return Response.json({ document: documentView(doc) });
}, { permission: "agent.manage" });

/** 035 — Elimina el documento y sus fragmentos: el agente deja de usarlo en el siguiente turno. */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? kbDocsOff();
  if (off) return off;
  const { id } = await ctx.params;
  const deleted = await deleteDocument(session.organizationId, id);
  if (!deleted) return apiError(404, "not_found", "Documento no encontrado");
  return new Response(null, { status: 204 });
}, { permission: "agent.manage" });
