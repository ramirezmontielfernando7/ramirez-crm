import { apiError, withAuth } from "@/lib/api";
import { createKnowledge, knowledgeTags, listKnowledge, serializeKnowledge } from "@/server/knowledge/store";
import { readKnowledgeInput } from "@/server/knowledge/input";
import { MediaValidationError } from "@/server/whatsapp/media";
import { assertCanUpload } from "@/server/limits";
import { checkStorageAlerts } from "@/server/limits/alerts";
import { limitBlocked } from "@/server/limits/http";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/**
 * 024 — Conocimientos. Ver y buscar: cualquier rol (`?q=` título, contenido,
 * etiquetas y nombre de archivo; `?tag=`). Son datos del negocio, no de
 * clientes.
 */
export const GET = withAuth(async (session, req: Request) => {
  const off = await moduleOff(session.organizationId, "knowledge");
  if (off) return off;
  const url = new URL(req.url);
  const [entries, tags] = await Promise.all([
    listKnowledge(session.organizationId, {
      q: url.searchParams.get("q") ?? undefined,
      tag: url.searchParams.get("tag") ?? undefined,
    }),
    knowledgeTags(session.organizationId),
  ]);
  return Response.json({ entries: entries.map(serializeKnowledge), tags });
});

/** Crear: Propietario y Coordinador. Texto, archivo o ambos. */
export const POST = withAuth(async (session, req: Request) => {
  const off = await moduleOff(session.organizationId, "knowledge");
  if (off) return off;
  const input = await readKnowledgeInput(req);
  if (!input.ok) return input.response;
  const { title, body = "", tags = [], file } = input.data;
  if (!title) return apiError(422, "invalid_body", "El título es obligatorio");
  if (!body && !file) {
    return apiError(422, "invalid_body", "Agrega un contenido de texto o un archivo");
  }
  // 036 (PR 3a): con «Bloquear subidas manuales», no pasar el tope de almacenamiento.
  if (file) {
    const blocked = await limitBlocked(() => assertCanUpload(session.organizationId, file.data.byteLength));
    if (blocked) return blocked;
  }
  try {
    const row = await createKnowledge({
      organizationId: session.organizationId,
      userId: session.userId,
      title,
      body,
      tags,
      file: file ?? null,
    });
    if (file) void checkStorageAlerts(session.organizationId);
    return Response.json({ entry: serializeKnowledge(row) }, { status: 201 });
  } catch (err) {
    if (err instanceof MediaValidationError) {
      return apiError(err.code === "too_large" ? 413 : 415, err.code, err.message);
    }
    throw err;
  }
}, { permission: "knowledge.manage" });
