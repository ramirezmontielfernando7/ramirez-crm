import { withAuth } from "@/lib/api";
import { getEffectiveLimits } from "@/server/limits";
import { getPlanCatalog } from "@/server/plan-catalog/store";

export const dynamic = "force-dynamic";

/**
 * Los planes que el Propietario puede elegir en «Mejora tu plan» y cuál tiene
 * hoy (`personalizado` si su empresa tiene una combinación propia). Precios en
 * pesos más IVA; nunca costos ni dólares. Solo el Propietario (`usage.read`).
 */
export const GET = withAuth(
  async (session) => {
    const limits = await getEffectiveLimits(session.organizationId);
    return Response.json({ current: limits.planKey, catalog: await getPlanCatalog() });
  },
  { permission: "usage.read" }
);
