import { can } from "@/lib/auth/permissions";
import type { SessionContext } from "@/lib/auth/session";
import type { Access } from "@/lib/db/tenant";

/**
 * 020 — De quién son los números que pide esta sesión.
 *
 * - Propietario/Coordinador (`results.all`): todo el equipo, o un asesor con
 *   `?userId=<id>`.
 * - Asesor: SIEMPRE los suyos. Pedir los de otro con `?userId=` es 403 — no
 *   se ignora en silencio, para que un cliente mal hecho no crea que está
 *   viendo lo que pidió.
 */
export function resultsScope(
  session: SessionContext,
  url: URL
): { ok: true; scope: Access } | { ok: false } {
  const userId = url.searchParams.get("userId")?.trim() || null;
  if (!can(session, "results.all")) {
    if (userId && userId !== session.userId) return { ok: false };
    return {
      ok: true,
      scope: {
        organizationId: session.organizationId,
        userId: session.userId,
        seesAll: false,
      },
    };
  }
  if (userId) {
    return {
      ok: true,
      scope: { organizationId: session.organizationId, userId, seesAll: false },
    };
  }
  return {
    ok: true,
    scope: {
      organizationId: session.organizationId,
      userId: session.userId,
      seesAll: true,
    },
  };
}
