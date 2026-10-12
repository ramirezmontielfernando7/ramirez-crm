import { withAuth } from "@/lib/api";
import { getOwnerUsage } from "@/server/usage/owner";

export const dynamic = "force-dynamic";

/**
 * 036 (PR 6) — «Uso y plan»: el consumo del mes de la organización de quien
 * pide contra sus topes. Solo el Propietario (`usage.read`); siempre la
 * organización de la sesión, nunca otra.
 */
export const GET = withAuth(
  async (session) => Response.json({ usage: await getOwnerUsage(session.organizationId) }),
  { permission: "usage.read" }
);
