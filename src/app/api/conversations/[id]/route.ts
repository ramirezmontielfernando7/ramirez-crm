import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { publish } from "@/server/events/bus";
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
