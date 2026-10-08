import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { groupIdFromKey } from "@/lib/kb-docs";
import { kbDocsOff } from "@/server/kb-docs/flag";
import { documentView, withKbDocErrors } from "@/server/kb-docs/http";
import { deleteDocument, getDocument, moveDocument } from "@/server/kb-docs/store";
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

/** 037 — `general` (o null) = General. */
const patchSchema = z.object({ groupId: z.string().trim().min(1).max(64).nullable() });

/** 037 — Mueve el documento a otro grupo: los agentes lo leen según su nuevo grupo desde el siguiente turno. */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? kbDocsOff();
  if (off) return off;
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const groupId = body.data.groupId === null ? null : groupIdFromKey(body.data.groupId);
  return withKbDocErrors(async () => {
    const doc = await moveDocument(session.organizationId, id, groupId);
    if (!doc) return apiError(404, "not_found", "Documento no encontrado");
    return Response.json({ document: documentView(doc) });
  });
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
