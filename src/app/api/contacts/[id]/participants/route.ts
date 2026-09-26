import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { describeError } from "@/lib/log-safe";
import { getContactById } from "@/server/contacts";
import {
  addParticipant,
  listParticipants,
  ParticipantError,
  removeParticipant,
} from "@/server/assignment/participants";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function errorResponse(err: unknown, where: string): Response {
  if (err instanceof ParticipantError) return apiError(err.status, err.code, err.message);
  // Con drizzle 0.45 el error de BD llega envuelto (código real en `cause`):
  // al log solo va lo que describeError deja pasar.
  console.error(`[participantes] ${where}:`, describeError(err));
  return apiError(500, "internal", "No se pudo completar la acción. Intenta de nuevo.");
}

/**
 * 026 — Participantes de un chat: quienes lo ven y atienden además del
 * asignado. Los lee quien puede ver el contacto (un participante o asignado
 * ve la lista de su propio chat); el de otro es 404.
 */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  try {
    const contact = await getContactById(session.access, id);
    if (!contact) return apiError(404, "not_found", "Contacto no encontrado");
    return Response.json({ participants: await listParticipants(session.organizationId, id) });
  } catch (err) {
    return errorResponse(err, "listar");
  }
});

const bodySchema = z.object({ userId: z.string().min(1).max(64) });

/** Agregar un participante: Propietario y Coordinador (`assignment.manage`). */
export const POST = withAuth(
  async (session, req: Request, ctx: Params) => {
    const { id } = await ctx.params;
    const body = await parseBody(req, bodySchema);
    if (!body.ok) return body.response;
    try {
      const result = await addParticipant({
        organizationId: session.organizationId,
        contactId: id,
        userId: body.data.userId,
        actorUserId: session.userId,
      });
      return Response.json(result, { status: result.added ? 201 : 200 });
    } catch (err) {
      return errorResponse(err, "agregar");
    }
  },
  { permission: "assignment.manage" }
);

/** Quitar un participante (`?userId=`). La asignación principal no cambia. */
export const DELETE = withAuth(
  async (session, req: Request, ctx: Params) => {
    const { id } = await ctx.params;
    const userId = new URL(req.url).searchParams.get("userId")?.trim();
    if (!userId || userId.length > 64) {
      return apiError(422, "invalid_query", "Falta userId");
    }
    try {
      return Response.json(
        await removeParticipant({
          organizationId: session.organizationId,
          contactId: id,
          userId,
          actorUserId: session.userId,
        })
      );
    } catch (err) {
      return errorResponse(err, "quitar");
    }
  },
  { permission: "assignment.manage" }
);
