import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { assignContacts } from "@/server/assignment/assign";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** Uno o varios contactos (el lead y el chat viajan con su contacto). */
  contactIds: z.array(z.string().min(1)).min(1).max(500),
  /** null = dejar sin asignar. */
  userId: z.string().min(1).nullable(),
  reason: z.string().trim().max(200).optional(),
});

/**
 * 020 — Asignar o reasignar chats/leads (Coordinador y Propietario). Con más
 * de un contacto es una reasignación en lote: un solo `batch_id`.
 */
export const POST = withAuth(
  async (session, req: Request) => {
    const body = await parseBody(req, bodySchema);
    if (!body.ok) return body.response;

    const res = await assignContacts({
      organizationId: session.organizationId,
      contactIds: body.data.contactIds,
      toUserId: body.data.userId,
      actorUserId: session.userId,
      source: body.data.contactIds.length > 1 ? "lote" : "manual",
      reason: body.data.reason ?? null,
    });
    if (!res.ok) {
      return res.reason === "assignee_not_member"
        ? apiError(422, "invalid_assignee", "Esa persona no es parte del equipo")
        : apiError(404, "not_found", "Contacto no encontrado");
    }
    return Response.json({ changed: res.changed.length, batchId: res.batchId });
  },
  { permission: "assignment.manage" }
);
