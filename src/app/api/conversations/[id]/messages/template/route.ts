import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getConversation } from "@/server/inbox/queries";
import { SendError } from "@/server/inbox/send";
import {
  sendTemplate,
  TemplateError,
  templateErrorStatus,
} from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  templateId: z.string().min(1),
  /** Valores de {{1}}..{{n}} en orden. `variable` sigue vivo por compatibilidad. */
  variables: z.array(z.string().trim().max(500)).max(10).optional(),
  variable: z.string().trim().max(500).optional(),
});

export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  // 020: escribir en un chat ajeno es tan 404 como leerlo.
  if (!(await getConversation(session.access, id))) {
    return apiError(404, "not_found", "Conversación no encontrada");
  }
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  try {
    const result = await sendTemplate({
      organizationId: session.organizationId,
      conversationId: id,
      templateId: body.data.templateId,
      variables:
        body.data.variables ??
        (body.data.variable === undefined ? undefined : [body.data.variable]),
    });
    return Response.json({ messageId: result.messageId });
  } catch (err) {
    if (err instanceof TemplateError) {
      return apiError(templateErrorStatus(err), err.code, err.message);
    }
    if (err instanceof SendError) {
      return apiError(403, err.code, err.message);
    }
    throw err;
  }
});
