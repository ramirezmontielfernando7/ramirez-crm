import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { can, type Permission } from "@/lib/auth/permissions";
import type { Access } from "@/lib/db/tenant";
import { resolveMembership } from "@/server/auth/on-signup";
import { runWithOrganization } from "@/lib/request-context";
import { delegatedGrants } from "@/server/team-chat/settings";

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
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError();
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

/** Igual que requireSession pero devuelve null en vez de lanzar. */
export async function getSessionOrNull(): Promise<SessionContext | null> {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}
