import { eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/log";
import { createTeamLink } from "@/server/platform-admin/links";
import { postSystemNotice } from "@/server/team-chat/messages";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const log = logger("team");

/** 20 enlaces cada 10 minutos por organización: de sobra para el día a día. */
const LINK_LIMIT = { windowMs: 10 * 60 * 1000, max: 20 };

/**
 * Auditoría UX 2026-11 (13) — Enlace para que alguien del equipo entre y
 * ponga su contraseña (si no usó la invitación o la olvidó). Lo genera el
 * Propietario y lo manda por WhatsApp; vale 72 h y un solo uso. Nunca para el
 * Propietario ni para quien pide, y nunca para una cuenta que también está en
 * otra empresa. Queda un aviso en el canal de Avisos del equipo.
 */
export const POST = withAuth(
  async (session, _req: Request, ctx: Params) => {
    const { id } = await ctx.params;
    if (!checkRateLimit(`team-link:${session.organizationId}`, LINK_LIMIT).allowed) {
      return apiError(429, "rate_limited", "Demasiados enlaces seguidos; espera unos minutos");
    }
    const [member] = await getDb()
      .select({ userId: schema.member.userId, role: schema.member.role, name: schema.user.name })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
      .where(scoped(schema.member.organizationId, session.organizationId, eq(schema.member.id, id)))
      .limit(1);
    if (!member) return apiError(404, "not_found", "Miembro no encontrado");
    if (member.role === "owner" || member.userId === session.userId) {
      return apiError(422, "owner_locked", "Tu propia contraseña se cambia desde tu cuenta");
    }
    const link = await createTeamLink(session.organizationId, member.userId, session.userId);
    if ("error" in link) {
      return apiError(
        409,
        "other_org",
        "Esta persona también trabaja en otra empresa de la plataforma: pide el enlace a soporte."
      );
    }
    try {
      const [me] = await getDb()
        .select({ name: schema.user.name })
        .from(schema.user)
        .where(eq(schema.user.id, session.userId))
        .limit(1);
      await postSystemNotice(
        session.organizationId,
        `🔑 ${me?.name ?? "El Propietario"} generó un enlace para que ${member.name} entre y ponga una contraseña nueva. Vale 72 horas y un solo uso.`
      );
    } catch (err) {
      log.error("no se pudo publicar el aviso del enlace", { org: session.organizationId, err });
    }
    return Response.json({ url: link.url, expiresAt: link.expiresAt.toISOString() });
  },
  { permission: "users.manage" }
);
