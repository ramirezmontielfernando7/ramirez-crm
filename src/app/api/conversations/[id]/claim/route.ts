import { apiError, withAuth } from "@/lib/api";
import { assignContacts } from "@/server/assignment/assign";
import { getConversation } from "@/server/inbox/queries";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * «Tomar este chat»: quien lo ve y nadie lo tiene, se lo asigna a sí mismo.
 * Cualquier rol puede, pero solo sobre un chat que YA ve (`getConversation`
 * respeta el filtro del asesor) y que sigue sin dueño: si otra persona lo
 * tomó antes, 409. Pasa por la única puerta de asignación (bitácora y aviso
 * en vivo incluidos).
 */
export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const row = await getConversation(session.access, id);
  if (!row) return apiError(404, "not_found", "Conversación no encontrada");
  const owner = row.contact.assignedUserId;
  if (owner) {
    return owner === session.userId
      ? Response.json({ ok: true, alreadyYours: true })
      : apiError(409, "already_assigned", "Otra persona ya tomó este chat.");
  }
  const r = await assignContacts({
    organizationId: session.organizationId,
    contactIds: [row.conversation.contactId],
    toUserId: session.userId,
    actorUserId: session.userId,
    source: "manual",
    reason: "tomado",
    onlyIfUnassigned: true,
  });
  if (!r.ok) {
    return r.reason === "already_assigned"
      ? apiError(409, "already_assigned", "Otra persona ya tomó este chat.")
      : apiError(404, "not_found", "Conversación no encontrada");
  }
  return Response.json({ ok: true });
});
