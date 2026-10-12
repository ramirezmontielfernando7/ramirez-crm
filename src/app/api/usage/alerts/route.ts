import { withAuth } from "@/lib/api";
import { markAlertsSeen } from "@/server/limits/alerts";
import { listOwnerAlerts } from "@/server/usage/owner";

export const dynamic = "force-dynamic";

/**
 * 036 (PR 3a) — Los avisos de consumo del mes que el Propietario aún no ha
 * visto (80 % y 100 % de cada tope; de cada medida, solo el más alto). Para
 * el aviso de la app. Solo el Propietario (`usage.read`).
 *
 * 038 (PR 1): el texto y las cifras de los avisos de IA siguen la visibilidad
 * de la organización (sin tokens salvo que el administrador los habilite).
 */
export const GET = withAuth(
  async (session) => Response.json({ alerts: await listOwnerAlerts(session.organizationId, { onlyUnseen: true }) }),
  { permission: "usage.read" }
);

/** El Propietario los marca como vistos (dejan de salir hasta el siguiente umbral o mes). */
export const POST = withAuth(
  async (session) => {
    const seen = await markAlertsSeen(session.organizationId, session.userId);
    return Response.json({ seen });
  },
  { permission: "usage.read" }
);
