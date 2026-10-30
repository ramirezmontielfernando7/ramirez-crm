import { UPLOAD_LINK_STATE_TEXT } from "@/lib/ai-connector";
import { apiError, withAuth } from "@/lib/api";
import { titleFromFilename } from "@/lib/kb-docs";
import { attachEntry, findUploadLink, stateOf } from "@/server/ai-connector/upload-links";
import { readKnowledgeInput } from "@/server/knowledge/input";
import { createKnowledge, deleteKnowledge } from "@/server/knowledge/store";
import { enableRagForEntry, libraryAccess, setEntryInChat } from "@/server/library/bridge";
import { withLibraryErrors } from "@/server/library/http";
import { assertCanUpload } from "@/server/limits";
import { checkStorageAlerts } from "@/server/limits/alerts";
import { limitBlocked } from "@/server/limits/http";
import { conectorIaOff, moduleOff } from "@/server/modules";
import { withUploadSlot } from "@/server/uploads/body";
import { MediaValidationError } from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

/**
 * 047 — Un archivo por llamada desde `/subir/<token>`: la persona, con su
 * sesión, sube a la Biblioteca con las etiquetas y los destinos del enlace
 * que pidió su IA. Mismas reglas que la Biblioteca (`knowledge.manage`,
 * tipos y tamaños de 044, tope de almacenamiento, «Lectura IA» por la puerta
 * del puente). El título sale del nombre del archivo.
 */
export const POST = withAuth(async (session, req: Request, ctx: { params: Promise<{ token: string }> }) => {
  return withUploadSlot(req, async () => {
    const org = session.organizationId;
    const off = (await conectorIaOff(org)) ?? (await moduleOff(org, "knowledge"));
    if (off) return off;
    const { token } = await ctx.params;
    const link = await findUploadLink(org, session.userId, token);
    if (!link) return apiError(404, "not_found", "Este enlace no existe o no es tuyo");
    const state = stateOf(link);
    if (state !== "open") return apiError(410, state, UPLOAD_LINK_STATE_TEXT[state]);
    if (link.rag && !(await libraryAccess(session)).rag) {
      return apiError(403, "forbidden", "No puedes entrenar a la IA del CRM desde aquí");
    }

    const input = await readKnowledgeInput(req);
    if (!input.ok) return input.response;
    const file = input.data.file;
    if (!file) return apiError(422, "invalid_body", "Falta el archivo");
    const blocked = await limitBlocked(() => assertCanUpload(org, file.data.byteLength));
    if (blocked) return blocked;

    let row;
    try {
      row = await createKnowledge({
        organizationId: org,
        userId: session.userId,
        title: titleFromFilename(file.fileName),
        body: "",
        tags: link.tags,
        file,
        showInChat: link.inChat,
      });
    } catch (err) {
      if (err instanceof MediaValidationError) {
        return apiError(err.code === "too_large" ? 413 : 415, err.code, err.message);
      }
      throw err;
    }
    // Si mientras subía se cerró, venció o se llenó, no se queda a medias.
    if (!(await attachEntry(org, link.id, row.id))) {
      await deleteKnowledge(org, row.id);
      return apiError(410, "closed", "Este enlace ya no recibe archivos. Pídele a tu IA uno nuevo.");
    }
    void checkStorageAlerts(org);

    let ragError: string | null = null;
    if (link.rag) {
      const res = await withLibraryErrors(async () => {
        await enableRagForEntry({ organizationId: org, userId: session.userId, entry: row, groupId: link.ragGroupId });
        return new Response(null, { status: 204 });
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        ragError = j?.error?.message ?? "No se pudo entrenar a la IA del CRM";
        // Sin «Lectura IA» y sin Bandeja quedaría sin destino: se muestra en la Bandeja.
        if (!link.inChat) await setEntryInChat(org, row, true);
      }
    }
    return Response.json(
      { entry: { id: row.id, title: row.title, fileName: row.fileName }, ragError },
      { status: 201 }
    );
  });
}, { permission: "knowledge.manage" });
