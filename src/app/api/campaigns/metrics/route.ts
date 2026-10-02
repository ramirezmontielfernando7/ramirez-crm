import { apiError, withAuth } from "@/lib/api";
import { PeriodError } from "@/server/analytics/period";
import { campaignsDisabledResponse, campaignsEnabled } from "@/server/campaigns/flag";
import { getCampaignMetrics } from "@/server/campaigns/metrics";

export const dynamic = "force-dynamic";

/**
 * Campañas v2 (PR 3) — Pestaña Métricas: KPIs, serie por día, tabla de
 * campañas, costo estimado frente al reportado por Meta y estado de las
 * analíticas. `?from=AAAA-MM-DD&to=AAAA-MM-DD&phone=<phone_number_id>`.
 * Solo lee la base propia: nunca consulta a Meta en vivo.
 */
export const GET = withAuth(
  async (session, req: Request) => {
    if (!(await campaignsEnabled(session.organizationId))) return campaignsDisabledResponse();
    const url = new URL(req.url);
    try {
      return Response.json(
        await getCampaignMetrics(session.organizationId, {
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
          phoneNumberId: url.searchParams.get("phone"),
        })
      );
    } catch (err) {
      if (err instanceof PeriodError) return apiError(422, "invalid_period", err.message);
      throw err;
    }
  },
  { permission: "campaigns.manage" }
);
