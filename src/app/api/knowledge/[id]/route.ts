import { apiError, withAuth } from "@/lib/api";
import {
  deleteKnowledge,
  getKnowledge,
  updateKnowledge,
} from "@/server/knowledge/store";
import { refreshRagForEntry } from "@/server/library/bridge";
import { withLibraryErrors } from "@/server/library/http";
import { withRag } from "@/server/library/view";
import { readKnowledgeInput } from "@/server/knowledge/input";
import { withUploadSlot } from "@/server/uploads/body";
import { MediaValidationError } from "@/server/whatsapp/media";
import { assertCanUpload } from "@/server/limits";
import { checkStorageAlerts } from "@/server/limits/alerts";
import { limitBlocked } from "@/server/limits/http";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const off = await moduleOff(session.organizationId, "knowledge");
  if (off) return off;
  const { id } = await ctx.params;
  const row = await getKnowledge(session.organizationId, id);
  if (!row) return apiError(404, "not_found", "Entrada no encontrada");
  const [entry] = await withRag(session.organizationId, [row]);
  return Response.json({ entry });
});

/** 024 — Editar (Propietario y Coordinador). `removeFile=true` quita el archivo. */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  // 044: pocas subidas pesadas a la vez (el archivo vive en memoria todo el turno).
  return withUploadSlot(req, async () => {
    const off = await moduleOff(session.organizationId, "knowledge");
    if (off) return off;
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

    // 036 (PR 3a): un archivo nuevo cuenta lo que crece (el nuevo menos el que reemplaza).
    const nuevo = input.data.file;
    if (nuevo) {
      const crece = nuevo.data.byteLength - (current.fileSize ?? 0);
      const blocked = await limitBlocked(() => assertCanUpload(session.organizationId, crece));
      if (blocked) return blocked;
    }
    try {
      const row = await updateKnowledge(session.organizationId, id, input.data);
      if (!row) return apiError(404, "not_found", "Entrada no encontrada");
      if (nuevo) void checkStorageAlerts(session.organizationId);
      // 040: si alimenta a la IA y cambió su contenido, el documento se rehace.
      let ragError: string | null = null;
      if (nuevo || input.data.body !== undefined) {
        const res = await withLibraryErrors(async () => {
          await refreshRagForEntry(session.organizationId, session.userId, row);
          return new Response(null, { status: 204 });
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          ragError = j?.error?.message ?? "No se pudo actualizar la lectura de la IA";
        }
      }
      const [entry] = await withRag(session.organizationId, [row]);
      return Response.json({ entry, ragError });
    } catch (err) {
      if (err instanceof MediaValidationError) {
        return apiError(err.code === "too_large" ? 413 : 415, err.code, err.message);
      }
      throw err;
    }
  });
}, { permission: "knowledge.manage" });

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const off = await moduleOff(session.organizationId, "knowledge");
  if (off) return off;
  const { id } = await ctx.params;
  const ok = await deleteKnowledge(session.organizationId, id);
  if (!ok) return apiError(404, "not_found", "Entrada no encontrada");
  return new Response(null, { status: 204 });
}, { permission: "knowledge.manage" });
