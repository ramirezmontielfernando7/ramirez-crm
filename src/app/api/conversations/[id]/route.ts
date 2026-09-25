import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { publish } from "@/server/events/bus";
import { logActivitySafe } from "@/server/activity/log";
import { serializeConversation, getConversation, updateConversation } from "@/server/inbox/queries";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  aiEnabled: z.boolean().optional(),
  reactivate: z.boolean().optional(),
  markRead: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  // 020: primero, ¿la puede ver? La de otro asesor es un 404, no un 403.
  const visible = await getConversation(session.access, id);
  if (!visible) return apiError(404, "not_found", "Conversación no encontrada");

  const updated = await updateConversation(session.access, id, body.data);
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
