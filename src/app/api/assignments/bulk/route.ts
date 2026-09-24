import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { isMemberOf, reassignAllFrom } from "@/server/assignment/assign";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** De quién se toman TODOS sus chats (p. ej. el asesor que sale de vacaciones). */
  fromUserId: z.string().min(1),
  /** A quién pasan; null = quedan sin asignar para repartirlos después. */
  toUserId: z.string().min(1).nullable(),
  reason: z.string().trim().max(200).optional(),
});

/** 020 — Reasignación en lote de todo lo de una persona. */
export const POST = withAuth(
  async (session, req: Request) => {
    const body = await parseBody(req, bodySchema);
    if (!body.ok) return body.response;
    if (body.data.fromUserId === body.data.toUserId) {
      return apiError(422, "same_user", "Elige a otra persona");
    }
    if (!(await isMemberOf(session.organizationId, body.data.fromUserId))) {
      return apiError(404, "not_found", "Esa persona no es parte del equipo");
    }

    const res = await reassignAllFrom({
      organizationId: session.organizationId,
      fromUserId: body.data.fromUserId,
      toUserId: body.data.toUserId,
      actorUserId: session.userId,
      reason: body.data.reason ?? null,
    });
    if (!res.ok) {
      return apiError(422, "invalid_assignee", "Esa persona no es parte del equipo");
    }
    return Response.json({ changed: res.changed.length, batchId: res.batchId });
  },
  { permission: "assignment.manage" }
);
