import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { reauthenticate } from "@/server/platform-admin/admins";
import { recordPlatformAudit } from "@/server/platform-admin/audit";
import { actorOf, withPlatformAdmin } from "@/server/platform-admin/http";
import { createAccountLink } from "@/server/platform-admin/links";
import { findUserForReset } from "@/server/platform-admin/organizations";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  /** La contraseña del ADMINISTRADOR (no la de la persona): reautenticación. */
  password: z.string().min(1).max(200),
});

/**
 * Fase 3, PR 2 — Enlace de un solo uso (2 h) para que una persona de
 * cualquier organización ponga SU contraseña. El administrador nunca la ve
 * ni la fija: vuelve a escribir la suya y recibe el enlace una vez. 3 fallos
 * → bloqueo de 15 minutos. Todo queda en la bitácora.
 */
export const POST = withPlatformAdmin(async (admin, ip, req, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const auth = await reauthenticate(admin, body.data.password, ip);
  if (!auth.ok) {
    return auth.reason === "locked"
      ? apiError(423, "locked", `Demasiados intentos. Vuelve a intentar después de las ${auth.lockedUntil?.toISOString().slice(11, 16)} UTC.`)
      : apiError(403, "wrong_password", "Tu contraseña de administrador no es correcta");
  }

  if (id === admin.userId) {
    return apiError(422, "self", "Para tu propia cuenta usa el cambio de contraseña normal");
  }
  const person = await findUserForReset(id);
  if (!person) return apiError(404, "not_found", "Usuario no encontrado");

  const link = await createAccountLink(person.id, "reset", admin.userId);
  await recordPlatformAudit({
    actor: actorOf(admin),
    action: "link.reset_created",
    org: person.org,
    user: { id: person.id, email: person.email },
    detail: { caduca: link.expiresAt.toISOString() },
    ip,
  });
  return Response.json({ url: link.url, expiresAt: link.expiresAt.toISOString() }, { status: 201 });
});
