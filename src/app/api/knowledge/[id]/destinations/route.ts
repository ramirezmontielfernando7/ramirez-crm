import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { groupIdFromKey } from "@/lib/kb-docs";
import { getKnowledge } from "@/server/knowledge/store";
import { disableRagForEntry, enableRagForEntry, libraryAccess, setEntryInChat } from "@/server/library/bridge";
import { withLibraryErrors } from "@/server/library/http";
import { withRag } from "@/server/library/view";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    /** «💬 Envío en chat». */
    chat: z.boolean().optional(),
    /** «🤖 Lectura IA (RAG)». */
    rag: z.boolean().optional(),
    /** Al encender la IA: el grupo de documentos (`general` o ausente = General). */
    groupId: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
  .refine((b) => b.chat !== undefined || b.rag !== undefined, "Nada que cambiar");

/**
 * 040 — Biblioteca unificada: enciende o apaga los destinos de UNA entrada
 * sin volver a subir el archivo. `knowledge.manage` siempre; la IA además
 * pide Documentos del agente en la organización y `agent.manage` (403). Un
 * destino al menos (422 al apagar el último).
 */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const off = await moduleOff(session.organizationId, "knowledge");
  if (off) return off;
  const { id } = await ctx.params;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const { chat, rag, groupId } = body.data;
  if (chat === false && rag === false) {
    return apiError(422, "last_destination", "Para quitarlo de todos lados, elimínalo.");
  }
  if (rag !== undefined && !(await libraryAccess(session)).rag) {
    return apiError(403, "forbidden", "No puedes entrenar al Agente de IA desde aquí");
  }
  return withLibraryErrors(async () => {
    let entry = await getKnowledge(session.organizationId, id);
    if (!entry) return apiError(404, "not_found", "Entrada no encontrada");
    // Primero lo que enciende: así apagar el otro en la misma llamada no choca con «un destino al menos».
    if (rag === true) {
      await enableRagForEntry({
        organizationId: session.organizationId,
        userId: session.userId,
        entry,
        groupId: groupId ? groupIdFromKey(groupId) : null,
      });
    }
    if (chat === true) entry = await setEntryInChat(session.organizationId, entry, true);
    if (chat === false) entry = await setEntryInChat(session.organizationId, entry, false);
    if (rag === false) await disableRagForEntry(session.organizationId, entry);
    const [dto] = await withRag(session.organizationId, [entry]);
    return Response.json({ entry: dto });
  });
}, { permission: "knowledge.manage" });
