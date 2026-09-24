import { apiError, withAuth } from "@/lib/api";
import { listAssignmentHistory } from "@/server/assignment/assign";
import { getContactById } from "@/server/contacts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 020 — Historial de asignaciones de un contacto: quién lo tuvo, desde
 * cuándo y quién lo reasignó. Lo lee quien puede ver el contacto (un asesor,
 * el de sus propios clientes); el de otro es 404.
 */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const contact = await getContactById(session.access, id);
  if (!contact) return apiError(404, "not_found", "Contacto no encontrado");
  const history = await listAssignmentHistory(session.organizationId, id);
  return Response.json({
    assignedUserId: contact.assignedUserId,
    assignedAt: contact.assignedAt?.toISOString() ?? null,
    history,
  });
});
