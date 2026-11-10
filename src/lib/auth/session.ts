import { cache } from "react";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { can, type Permission } from "@/lib/auth/permissions";
import type { Access } from "@/lib/db/tenant";
import { resolveMembership } from "@/server/auth/on-signup";
import { runWithOrganization } from "@/lib/request-context";
import { delegatedGrants } from "@/server/team-chat/settings";
import { isOrgActive } from "@/server/platform-admin/org-status";

export type SessionContext = {
  userId: string;
  organizationId: string;
  role: string;
  /** 020 — qué datos de clientes ve esta sesión (ver `scopedContacts`). */
  access: Access;
  /**
   * 025 — Permisos que la organización le delegó a este rol desde Ajustes
   * (solo cuentan los que `DELEGABLE` declara; ver `can`).
   */
  grants?: readonly Permission[];
};

export class UnauthorizedError extends Error {
  constructor(message = "No autenticado") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** Arma el contexto a partir de la membresía (fuente de verdad del rol). */
export function sessionContext(
  userId: string,
  organizationId: string,
  role: string,
  grants: readonly Permission[] = []
): SessionContext {
  return {
    userId,
    organizationId,
    role,
    grants,
    access: {
      organizationId,
      userId,
      seesAll: can({ role }, "scope.all"),
    },
  };
}

/**
 * Sesión + organización activa para route handlers y server components.
 * Lanza UnauthorizedError si no hay sesión u organización.
 */
export async function requireSession(): Promise<SessionContext> {
  return requireSessionOnce();
}

/**
 * La sesión de Better Auth de ESTA petición. Con `cache` de React, una
 * pantalla la consulta una sola vez aunque la pidan el layout raíz, el de la
 * app, la página y la marca (antes eran 5 lecturas de sesión por pantalla).
 * Fuera de un render de servidor (rutas de API) `cache` no guarda nada y se
 * consulta como siempre.
 */
export const getAuthSession = cache(async () =>
  getAuth().api.getSession({ headers: await headers() })
);

type AuthSession = NonNullable<Awaited<ReturnType<typeof getAuthSession>>>;

/** De la sesión de Better Auth al contexto: membresía de HOY, organización activa y delegaciones. */
async function contextOf(session: AuthSession): Promise<SessionContext> {
  // La sesión puede crearse antes de que la membresía exista (registro
  // inicial) — la membresía en BD es la fuente de verdad de org + rol. H4:
  // la organización activa de la sesión manda, validada contra `member`.
  const membership = await resolveMembership(
    session.user.id,
    session.session.activeOrganizationId
  );
  if (!membership) {
    throw new UnauthorizedError("Sesión sin organización activa");
  }
  // Fase 3, PR 2: una organización suspendida o dada de baja no opera; sus
  // sesiones abiertas dejan de valer al instante (no solo el próximo login).
  if (!(await isOrgActive(membership.organizationId))) {
    throw new UnauthorizedError("Organización suspendida");
  }
  return sessionContext(
    session.user.id,
    membership.organizationId,
    membership.role,
    // PR 3: la organización ya se sabe; su ajuste se lee a su nombre.
    await runWithOrganization(membership.organizationId, () =>
      delegatedGrants(membership.organizationId, membership.role)
    )
  );
}

const requireSessionOnce = cache(async (): Promise<SessionContext> => {
  const session = await getAuthSession();
  if (!session) throw new UnauthorizedError();
  return contextOf(session);
});

/**
 * Para conexiones que viven horas (el canal SSE): la sesión de HOY a partir
 * de las cabeceras con las que se abrió la conexión, fuera de un render (no
 * usa `headers()` ni `cache`). null = ya no hay sesión, salió de la
 * organización o la organización dejó de operar. Un fallo de la base LANZA
 * (no es lo mismo que «ya no tiene sesión»).
 */
export async function sessionFromHeaders(h: Headers): Promise<SessionContext | null> {
  const session = await getAuth().api.getSession({ headers: h });
  if (!session) return null;
  try {
    return await contextOf(session);
  } catch (err) {
    if (err instanceof UnauthorizedError) return null;
    throw err;
  }
}

/** Igual que requireSession pero devuelve null en vez de lanzar. */
export async function getSessionOrNull(): Promise<SessionContext | null> {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}
