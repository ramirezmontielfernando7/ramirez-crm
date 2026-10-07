import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { publish } from "@/server/events/bus";
import { logActivitySafe } from "@/server/activity/log";
import { serializeConversation, getConversation, updateConversation } from "@/server/inbox/queries";
import { deleteConversation, setConversationArchived } from "@/server/inbox/lifecycle";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  aiEnabled: z.boolean().optional(),
  reactivate: z.boolean().optional(),
  markRead: z.boolean().optional(),
  /** 034: true archiva, false recupera. */
  archived: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  // 020: primero, ¿la puede ver? La de otro asesor es un 404, no un 403.
  const visible = await getConversation(session.access, id);
  if (!visible) return apiError(404, "not_found", "Conversación no encontrada");

  const { archived, ...patch } = body.data;
  if (archived !== undefined) {
    const res = await setConversationArchived(session.access, id, archived);
    if (!res) return apiError(404, "not_found", "Conversación no encontrada");
  }
  const updated = await updateConversation(session.access, id, patch);
  if (!updated) return apiError(404, "not_found", "Conversación no encontrada");

  // 022: pausar o reactivar la IA queda en la línea de tiempo del chat, con
  // quién lo hizo. Solo si de verdad cambió (marcar leído no es actividad).
  const before = visible.conversation.aiEnabled && !visible.conversation.handoffAt;
  const after = updated.aiEnabled && !updated.handoffAt;
  if (before !== after) {
    await logActivitySafe({
      organizationId: session.organizationId,
      contactId: updated.contactId,
      kind: after ? "ai_resumed" : "ai_paused",
      actorUserId: session.userId,
      source: "usuario",
    });
  }

  const row = await getConversation(session.access, id);
  if (row) {
    const dto = serializeConversation(
      row.conversation,
      row.contact,
      null,
      null,
      row.anuncio,
      row.assigneeName
    );
    publish(session.organizationId, {
      type: "conversation.updated",
      data: { conversation: dto },
    });
    return Response.json({ conversation: dto });
  }
  return Response.json({ conversation: null });
});

/**
 * 034 — Eliminar el chat y todos sus mensajes, para siempre. El permiso
 * (`conversation.delete`: Propietario y Coordinador) se valida ANTES de tocar
 * nada: sin él, 403. Después, igual que el resto: el chat que la sesión no ve
 * es un 404.
 */
export const DELETE = withAuth(
  async (session, _req: Request, ctx: Params) => {
    const { id } = await ctx.params;
    const ok = await deleteConversation(session.access, id);
    if (!ok) return apiError(404, "not_found", "Conversación no encontrada");
    return Response.json({ deleted: true });
  },
  { permission: "conversation.delete" }
);
