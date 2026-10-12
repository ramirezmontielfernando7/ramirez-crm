import { withAuth } from "@/lib/api";
import { alertText } from "@/lib/limits";
import { listAlerts, markAlertsSeen } from "@/server/limits/alerts";

export const dynamic = "force-dynamic";

/**
 * 036 (PR 3a) — Los avisos de consumo del mes que el Propietario aún no ha
 * visto (80 % y 100 % de cada tope; de cada medida, solo el más alto). Para
 * el aviso de la app. Solo el Propietario (`usage.read`).
 */
export const GET = withAuth(
  async (session) => {
    const alerts = await listAlerts(session.organizationId, { onlyUnseen: true });
    return Response.json({ alerts: alerts.map((a) => ({ ...a, text: alertText(a.metric, a.threshold) })) });
  },
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
