import { apiError, withAuth } from "@/lib/api";
import { can } from "@/lib/auth/permissions";
import { groupIdFromKey } from "@/lib/kb-docs";
import { createKnowledge, knowledgeTags, listKnowledge } from "@/server/knowledge/store";
import { enableRagForEntry, libraryAccess } from "@/server/library/bridge";
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

/**
 * 024 — Conocimientos. Ver y buscar: cualquier rol (`?q=` título, contenido,
 * etiquetas y nombre de archivo; `?tag=`). Son datos del negocio, no de
 * clientes.
 * 040 — Sin más, solo lo que aparece en la Bandeja (el selector del chat).
 * `?scope=library` (la pantalla Biblioteca): quien administra
 * (`knowledge.manage`) ve también los originales que solo lee la IA. Cada
 * entrada lleva su «Lectura IA» cuando la organización tiene Documentos del
 * agente; `library` dice qué destinos puede mover quien pide.
 */
export const GET = withAuth(async (session, req: Request) => {
  const off = await moduleOff(session.organizationId, "knowledge");
  if (off) return off;
  const url = new URL(req.url);
  const library = url.searchParams.get("scope") === "library";
  const [entries, tags, access] = await Promise.all([
    listKnowledge(session.organizationId, {
      q: url.searchParams.get("q") ?? undefined,
      tag: url.searchParams.get("tag") ?? undefined,
      chatOnly: !(library && can(session, "knowledge.manage")),
    }),
    knowledgeTags(session.organizationId),
    libraryAccess(session),
  ]);
  return Response.json({ entries: await withRag(session.organizationId, entries), tags, library: access });
});

/**
 * Crear: Propietario y Coordinador. Texto, archivo o ambos.
 * 040 — `rag=true` («Entrenar también al Agente de IA», `ragGroupId`
 * opcional): además crea el documento del agente por su puerta (límites,
 * duplicados, almacenamiento). Si eso falla, la entrada SÍ se queda (es
 * otro destino) y la respuesta trae `ragError` con el motivo.
 */
export const POST = withAuth(async (session, req: Request) => {
  // 044: pocas subidas pesadas a la vez (el archivo vive en memoria todo el turno).
  return withUploadSlot(req, async () => {
    const off = await moduleOff(session.organizationId, "knowledge");
    if (off) return off;
    const input = await readKnowledgeInput(req);
    if (!input.ok) return input.response;
    const { title, body = "", tags = [], file, rag, ragGroupId } = input.data;
    if (rag && !(await libraryAccess(session)).rag) {
      return apiError(403, "forbidden", "No puedes entrenar al Agente de IA desde aquí");
    }
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
      let ragError: { code: string; message: string } | null = null;
      if (rag) {
        const res = await withLibraryErrors(async () => {
          await enableRagForEntry({
            organizationId: session.organizationId,
            userId: session.userId,
            entry: row,
            groupId: ragGroupId ? groupIdFromKey(ragGroupId) : null,
          });
          return new Response(null, { status: 204 });
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
          ragError = { code: j?.error?.code ?? "internal", message: j?.error?.message ?? "No se pudo entrenar al agente" };
        }
      }
      const [entry] = await withRag(session.organizationId, [row]);
      return Response.json({ entry, ragError }, { status: 201 });
    } catch (err) {
      if (err instanceof MediaValidationError) {
        return apiError(err.code === "too_large" ? 413 : 415, err.code, err.message);
      }
      throw err;
    }
  });
}, { permission: "knowledge.manage" });
