import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { registerContact } from "@/server/inbox/new-number";
import { serializeContact } from "@/server/contacts";
import { newNumberErrorResponse } from "@/server/inbox/new-number-http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  phone: z.string().trim().min(1).max(40),
  /** Opcional: sin nombre, el contacto se muestra con su teléfono. */
  name: z.string().trim().max(120).optional(),
  stageId: z.string().min(1).optional(),
  assignToUserId: z.string().min(1).nullable().optional(),
});

/**
 * «Registrar contacto» desde la búsqueda de la Bandeja. Mismo acceso que
 * `POST /api/contacts` (cualquier rol; un asesor se queda con lo que da de
 * alta). Si el número ya existe devuelve ese contacto, sin duplicar.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  try {
    const { contact, created } = await registerContact(session, body.data);
    return Response.json({ contact: serializeContact(contact), created }, { status: created ? 201 : 200 });
  } catch (err) {
    const res = newNumberErrorResponse(err);
    if (res) return res;
    throw err;
  }
});
