import { apiError, withAuth } from "@/lib/api";
import { getContactById } from "@/server/contacts";
import { contactTimeline } from "@/server/activity/timeline";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 022 — Línea de tiempo del chat: notas, etapas, asignaciones, pausas de la
 * IA, consentimiento y etiquetas, lo más reciente primero. La lee quien puede
 * ver el contacto (un asesor, el de sus propios clientes; el de otro es 404),
 * y la ve COMPLETA, aunque parte haya pasado cuando el chat era de otro.
 */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const contact = await getContactById(session.access, id);
  if (!contact) return apiError(404, "not_found", "Contacto no encontrado");
  const items = await contactTimeline(session.organizationId, contact);
  return Response.json({ items });
});
