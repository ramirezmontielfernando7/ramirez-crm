import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getConversation } from "@/server/inbox/queries";
import { SendError } from "@/server/inbox/send";
import { deliverKnowledgeEntry, KnowledgeDeliveryError } from "@/server/knowledge/deliver";
import { getKnowledge } from "@/server/knowledge/store";
import { MediaValidationError } from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  entryId: z.string().min(1).max(64),
  mode: z.enum(["text", "file"]),
});

const SEND_ERROR_STATUS: Record<SendError["code"], number> = {
  sandbox_violation: 403,
  not_connected: 409,
  reconnect_required: 409,
  window_closed: 409,
  meta_error: 422,
  meta_unavailable: 503,
  upload_failed: 502,
};

/**
 * 024 — Envía una entrada de Conocimientos al cliente de esta conversación,
 * como mensaje de texto o como archivo. Cualquier rol, pero solo en un chat
 * que pueda ver (020: el ajeno es 404).
 */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  if (!(await getConversation(session.access, id))) {
    return apiError(404, "not_found", "Conversación no encontrada");
  }
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const entry = await getKnowledge(session.organizationId, body.data.entryId);
  if (!entry) return apiError(404, "not_found", "Entrada no encontrada");

  try {
    const result = await deliverKnowledgeEntry(
      { kind: "whatsapp_conversation", organizationId: session.organizationId, conversationId: id },
      entry,
      body.data.mode
    );
    return Response.json({ messageId: result.messageId }, { status: 201 });
  } catch (err) {
    if (err instanceof KnowledgeDeliveryError) return apiError(422, err.code, err.message);
    if (err instanceof MediaValidationError) {
      return apiError(err.code === "too_large" ? 413 : 415, err.code, err.message);
    }
    if (err instanceof SendError) {
      return apiError(SEND_ERROR_STATUS[err.code], err.code, err.message);
    }
    throw err;
  }
});
