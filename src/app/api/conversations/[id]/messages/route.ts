import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getConversation, listMessages } from "@/server/inbox/queries";
import { serializeMessage } from "@/server/inbox/ingest";
import { SEND_ERROR_STATUS } from "@/server/inbox/send-http";
import { SendError, sendStructured, sendText } from "@/server/inbox/send";
import { annotations, messageById } from "@/server/inbox/message-annotations";
import { CHAT_TEXT_MAX } from "@/lib/message-length";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const row = await getConversation(session.access, id);
  if (!row) return apiError(404, "not_found", "Conversación no encontrada");

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  const messages = await listMessages(
    session.access,
    id,
    since && !Number.isNaN(since.getTime()) ? since : undefined
  );
  const details = await annotations(session.access, id, messages.map((row) => row.message));
  return Response.json({
    messages: messages.map(({ message, media }) => {
      const quote = message.replyToWaMessageId ? details.quoted.get(message.replyToWaMessageId) : undefined;
      const { hasQuote: _hasQuote, ...dto } = serializeMessage(message, media);
      return { ...dto, reactions: details.visibleReactions.get(message.id) ?? [], replyTo: quote?.id === message.id ? null : quote ?? null };
    }),
  });
});

// 008: además de texto, el body acepta ubicación y contactos (discriminado
// por `type`; sin `type` sigue siendo texto — compat con clientes previos).
const sendSchema = z.union([
  z.object({
    type: z.literal("text").optional(),
    // Hasta 65,536 (lo de la app de WhatsApp): por Meta sale en partes de 4,096.
    text: z.string().trim().min(1).max(CHAT_TEXT_MAX),
    replyToMessageId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  }),
  z.object({
    type: z.literal("location"),
    location: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      name: z.string().trim().max(1000).optional(),
      address: z.string().trim().max(1000).optional(),
    }),
  }),
  z.object({
    type: z.literal("contacts"),
    contacts: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(200),
          phone: z.string().trim().min(5).max(30),
        })
      )
      .min(1)
      .max(5),
  }),
]);


export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  // 020: escribir en un chat ajeno es tan 404 como leerlo.
  if (!(await getConversation(session.access, id))) {
    return apiError(404, "not_found", "Conversación no encontrada");
  }
  const body = await parseBody(req, sendSchema);
  if (!body.ok) return body.response;

  try {
    const data = body.data;
    const quoteId = "text" in data ? data.replyToMessageId : undefined;
    const replyTo = quoteId ? await messageById(session.access, id, quoteId) : undefined;
    if (quoteId && !replyTo) return apiError(404, "not_found", "Mensaje no encontrado");
    const result =
      "text" in data
        ? await sendText({
            conversationId: id,
            organizationId: session.organizationId,
            text: data.text,
            replyTo,
            // Conexión directa (PR 3): una persona escribiendo puede salir
            // por el dispositivo vinculado si el chat está en ese modo.
            allowDirect: true,
          })
        : data.type === "location"
          ? await sendStructured({
              conversationId: id,
              organizationId: session.organizationId,
              kind: "location",
              location: data.location,
            })
          : await sendStructured({
              conversationId: id,
              organizationId: session.organizationId,
              kind: "contacts",
              contacts: data.contacts,
            });
    return Response.json({
      messageId: result.messageId,
      ...(result.replyApplied !== undefined ? { replyApplied: result.replyApplied } : {}),
      ...(result.queuedUntil ? { queuedUntil: result.queuedUntil.toISOString() } : {}),
    });
  } catch (err) {
    if (err instanceof SendError) {
      return apiError(SEND_ERROR_STATUS[err.code], err.code, err.message);
    }
    throw err;
  }
});
