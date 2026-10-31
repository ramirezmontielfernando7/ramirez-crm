import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { answer } from "@/server/mi-numero/http";
import { miNumeroOff } from "@/server/mi-numero/numbers";
import { numberSendError } from "@/server/mi-numero/send-http";
import { KnowledgeDeliveryError } from "@/server/knowledge/deliver";
import { deliverKnowledgeToMyNumber } from "@/server/mi-numero/knowledge";
import { getKnowledgeForChat } from "@/server/knowledge/store";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  entryId: z.string().min(1).max(64),
  mode: z.enum(["text", "file"]),
});

/**
 * Mi número — Envía una entrada de Conocimientos (texto o archivo con el texto
 * como pie) por MI número. Solo mis chats (`sendFromMyNumber` lo revisa).
 */
export const POST = withAuth(async (session, req: Request, { params }: Params) => {
  const off = (await miNumeroOff(session.organizationId)) ?? (await moduleOff(session.organizationId, "knowledge"));
  if (off) return off;
  const { id } = await params;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const entry = await getKnowledgeForChat(session.organizationId, body.data.entryId);
  if (!entry) return apiError(404, "not_found", "Entrada no encontrada");
  return answer(async () => {
    try {
      const r = await deliverKnowledgeToMyNumber(
        { organizationId: session.organizationId, userId: session.userId, conversationId: id },
        entry,
        body.data.mode
      );
      return Response.json({ messageId: r.messageId }, { status: 201 });
    } catch (err) {
      if (err instanceof KnowledgeDeliveryError) return apiError(422, err.code, err.message);
      return numberSendError(err);
    }
  });
});
