import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { groupIdFromKey } from "@/lib/kb-docs";
import { kbDocsOff } from "@/server/kb-docs/flag";
import { documentView } from "@/server/kb-docs/http";
import { getDocument, moveDocument } from "@/server/kb-docs/store";
import { deleteDocumentAndHiddenOriginal, libraryAccess, setDocumentInChat } from "@/server/library/bridge";
import { withLibraryErrors } from "@/server/library/http";
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

/** 037 — `general` (o null) = General. 040: `chat` = «Envío en chat» encendido o apagado. */
const patchSchema = z
  .object({ groupId: z.string().trim().min(1).max(64).nullable().optional(), chat: z.boolean().optional() })
  .refine((b) => b.groupId !== undefined || b.chat !== undefined, "Nada que cambiar");

/**
 * 037 — Mueve el documento a otro grupo: los agentes lo leen según su nuevo grupo desde el siguiente turno.
 * 040 — `chat`: enciende o apaga su copia en la Bandeja (sin volver a subirlo;
 * pide el módulo Biblioteca y `knowledge.manage`).
 */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? kbDocsOff();
  if (off) return off;
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const { groupId: rawGroup, chat } = body.data;
  if (chat !== undefined && !(await libraryAccess(session)).chat) {
    return apiError(403, "forbidden", "No puedes publicar en la Biblioteca de la Bandeja");
  }
  return withLibraryErrors(async () => {
    let doc = await getDocument(session.organizationId, id);
    if (!doc) return apiError(404, "not_found", "Documento no encontrado");
    if (rawGroup !== undefined) {
      doc = await moveDocument(session.organizationId, id, rawGroup === null ? null : groupIdFromKey(rawGroup));
      if (!doc) return apiError(404, "not_found", "Documento no encontrado");
    }
    if (chat !== undefined) doc = await setDocumentInChat(session.organizationId, id, chat);
    return Response.json({ document: { ...documentView(doc), inChat: chat ?? undefined } });
  });
}, { permission: "agent.manage" });

/**
 * 035 — Elimina el documento y sus fragmentos: el agente deja de usarlo en el siguiente turno.
 * 040 — Si su original estaba guardado solo para él (oculto de la Bandeja), también se borra.
 */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? kbDocsOff();
  if (off) return off;
  const { id } = await ctx.params;
  const deleted = await deleteDocumentAndHiddenOriginal(session.organizationId, id);
  if (!deleted) return apiError(404, "not_found", "Documento no encontrado");
  return new Response(null, { status: 204 });
}, { permission: "agent.manage" });
