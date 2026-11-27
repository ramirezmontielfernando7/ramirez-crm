import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { validCustomerReaction } from "@/lib/customer-message-annotations";
import { messageById } from "@/server/inbox/message-annotations";
import { getConversation } from "@/server/inbox/queries";
import { SendError, setCustomerReaction } from "@/server/inbox/send";
import { SEND_ERROR_STATUS } from "@/server/inbox/send-http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  emoji: z.string().max(48).refine(validCustomerReaction, "Se requiere un solo emoji."),
}).strict();
type Params = { params: Promise<{ id: string; messageId: string }> };

export const PUT = withAuth(async (session, req: Request, ctx: Params) => {
  const { id, messageId } = await ctx.params;
  if (!(await getConversation(session.access, id))) {
    return apiError(404, "not_found", "Conversación no encontrada");
  }
  const message = await messageById(session.access, id, messageId);
  if (!message) return apiError(404, "not_found", "Mensaje no encontrado");
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  try {
    const result = await setCustomerReaction({
      organizationId: session.organizationId, conversationId: id, message, emoji: body.data.emoji,
      // Detectar la ruta del operador para rechazar el dispositivo vinculado.
      allowDirect: true,
    });
    if (result === "pending") {
      return apiError(409, "reaction_pending", "Otra reacción sigue sin confirmar. Revisa el chat antes de reintentar.");
    }
    return Response.json({ ok: true, changed: result === "sent" });
  } catch (err) {
    if (err instanceof SendError) return apiError(SEND_ERROR_STATUS[err.code], err.code, err.message);
    throw err;
  }
});
