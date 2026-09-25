import { apiError, withAuth } from "@/lib/api";
import {
  deleteKnowledge,
  getKnowledge,
  serializeKnowledge,
  updateKnowledge,
} from "@/server/knowledge/store";
import { readKnowledgeInput } from "@/server/knowledge/input";
import { MediaValidationError } from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const row = await getKnowledge(session.organizationId, id);
  if (!row) return apiError(404, "not_found", "Entrada no encontrada");
  return Response.json({ entry: serializeKnowledge(row) });
});

/** 024 — Editar (Propietario y Coordinador). `removeFile=true` quita el archivo. */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const input = await readKnowledgeInput(req);
  if (!input.ok) return input.response;

  const current = await getKnowledge(session.organizationId, id);
  if (!current) return apiError(404, "not_found", "Entrada no encontrada");
  const nextBody = input.data.body ?? current.body;
  const keepsFile = input.data.file === undefined ? Boolean(current.filePath) : input.data.file !== null;
  if (!nextBody && !keepsFile) {
    return apiError(422, "invalid_body", "La entrada quedaría vacía: deja texto o un archivo");
  }

  try {
    const row = await updateKnowledge(session.organizationId, id, input.data);
    if (!row) return apiError(404, "not_found", "Entrada no encontrada");
    return Response.json({ entry: serializeKnowledge(row) });
  } catch (err) {
    if (err instanceof MediaValidationError) {
      return apiError(err.code === "too_large" ? 413 : 415, err.code, err.message);
    }
    throw err;
  }
}, { permission: "knowledge.manage" });

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const ok = await deleteKnowledge(session.organizationId, id);
  if (!ok) return apiError(404, "not_found", "Entrada no encontrada");
  return new Response(null, { status: 204 });
}, { permission: "knowledge.manage" });
