import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import type { Access } from "@/lib/db/tenant";
import { resolveMembership } from "@/server/auth/on-signup";

export type SessionContext = {
  userId: string;
  organizationId: string;
  role: string;
  /** 020 — qué datos de clientes ve esta sesión (ver `scopedContacts`). */
  access: Access;
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
  role: string
): SessionContext {
  return {
    userId,
    organizationId,
    role,
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
  // inicial) — la membresía en BD es la fuente de verdad de org + rol.
  const membership = await resolveMembership(session.user.id);
  if (!membership) {
    throw new UnauthorizedError("Sesión sin organización activa");
  }
  return sessionContext(
    session.user.id,
    membership.organizationId,
    membership.role
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
