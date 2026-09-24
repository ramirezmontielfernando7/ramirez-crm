import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { ASSIGNABLE_ROLES, type Role } from "@/lib/auth/permissions";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { releaseAllFrom } from "@/server/assignment/assign";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function findMember(organizationId: string, memberId: string) {
  const rows = await getDb()
    .select()
    .from(schema.member)
    .where(
      scoped(schema.member.organizationId, organizationId, eq(schema.member.id, memberId))
    )
    .limit(1);
  return rows[0] ?? null;
}

const patchSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES as [Role, ...Role[]]),
});

/**
 * 020 — Cambiar el rol de alguien del equipo (solo el Propietario). El
 * propietario no se degrada desde aquí: la instancia se quedaría sin nadie que
 * pueda configurarla.
 */
export const PATCH = withAuth(
  async (session, req: Request, ctx: Params) => {
    const { id } = await ctx.params;
    const body = await parseBody(req, patchSchema);
    if (!body.ok) return body.response;

    const member = await findMember(session.organizationId, id);
    if (!member) return apiError(404, "not_found", "Miembro no encontrado");
    if (member.role === "owner") {
      return apiError(422, "owner_locked", "El rol del propietario no se cambia");
    }

    await getDb()
      .update(schema.member)
      .set({ role: body.data.role })
      .where(
        scoped(schema.member.organizationId, session.organizationId, eq(schema.member.id, id))
      );
    return Response.json({ ok: true, role: body.data.role });
  },
  { permission: "users.manage" }
);

/**
 * 020 — Sacar a alguien del equipo. Sus chats NO se quedan huérfanos: pasan a
 * "sin asignar" (con su evento en la bitácora) para que el coordinador los
 * reparta.
 */
export const DELETE = withAuth(
  async (session, _req: Request, ctx: Params) => {
    const { id } = await ctx.params;
    const member = await findMember(session.organizationId, id);
    if (!member) return apiError(404, "not_found", "Miembro no encontrado");
    if (member.role === "owner" || member.userId === session.userId) {
      return apiError(422, "owner_locked", "No puedes quitar al propietario");
    }

    await releaseAllFrom(session.organizationId, member.userId, session.userId);
    await getDb()
      .delete(schema.member)
      .where(
        scoped(schema.member.organizationId, session.organizationId, eq(schema.member.id, id))
      );
    return Response.json({ ok: true });
  },
  { permission: "users.manage" }
);
