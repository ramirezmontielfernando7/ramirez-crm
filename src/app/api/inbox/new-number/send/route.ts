import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { sendFirstTemplate } from "@/server/inbox/new-number";
import { serializeContact } from "@/server/contacts";
import { newNumberErrorResponse } from "@/server/inbox/new-number-http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  phone: z.string().trim().min(1).max(40),
  templateId: z.string().min(1),
  variables: z.array(z.string().trim().max(500)).max(10).optional(),
  /** «¿Aceptó recibir mensajes de tu negocio?» — «unknown» no envía. */
  consentAnswer: z.enum(["yes", "unknown"]),
});

/**
 * «Enviar mensaje» a un número nuevo: SOLO una plantilla aprobada y SOLO a
 * quien aceptó. Mismo acceso que enviar una plantilla desde un chat (cualquier
 * rol que vea ese contacto); el consentimiento y la baja los valida
 * `sendFirstTemplate`, y el envío es `sendTemplate` (el de las campañas).
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  try {
    const { contact, conversationId, messageId } = await sendFirstTemplate(session, {
      phone: body.data.phone,
      templateId: body.data.templateId,
      variables: body.data.variables,
      consent: body.data.consentAnswer,
    });
    return Response.json({ contact: serializeContact(contact), conversationId, messageId });
  } catch (err) {
    const res = newNumberErrorResponse(err);
    if (res) return res;
    throw err;
  }
});
