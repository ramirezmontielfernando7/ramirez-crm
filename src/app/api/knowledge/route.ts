import { apiError, withAuth } from "@/lib/api";
import { createKnowledge, knowledgeTags, listKnowledge, serializeKnowledge } from "@/server/knowledge/store";
import { readKnowledgeInput } from "@/server/knowledge/input";
import { MediaValidationError } from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

/**
 * 024 — Conocimientos. Ver y buscar: cualquier rol (`?q=` título, contenido,
 * etiquetas y nombre de archivo; `?tag=`). Son datos del negocio, no de
 * clientes.
 */
export const GET = withAuth(async (session, req: Request) => {
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
  const input = await readKnowledgeInput(req);
  if (!input.ok) return input.response;
  const { title, body = "", tags = [], file } = input.data;
  if (!title) return apiError(422, "invalid_body", "El título es obligatorio");
  if (!body && !file) {
    return apiError(422, "invalid_body", "Agrega un contenido de texto o un archivo");
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
    return Response.json({ entry: serializeKnowledge(row) }, { status: 201 });
  } catch (err) {
    if (err instanceof MediaValidationError) {
      return apiError(err.code === "too_large" ? 413 : 415, err.code, err.message);
    }
    throw err;
  }
}, { permission: "knowledge.manage" });
