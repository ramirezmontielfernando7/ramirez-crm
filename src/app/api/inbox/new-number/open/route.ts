import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { openChat } from "@/server/inbox/new-number";
import { serializeContact } from "@/server/contacts";
import { newNumberErrorResponse } from "@/server/inbox/new-number-http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ phone: z.string().trim().min(1).max(40) });

/**
 * «Abrir chat»: registra el contacto si hace falta y abre su conversación
 * (vacía si es nueva). No envía nada: sin ventana de 24 h el cuadro de
 * escribir solo ofrece plantillas, y el servidor lo exige en cada envío.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  try {
    const { contact, conversationId, created } = await openChat(session, body.data.phone);
    return Response.json({ contact: serializeContact(contact), conversationId, created });
  } catch (err) {
    const res = newNumberErrorResponse(err);
    if (res) return res;
    throw err;
  }
});
