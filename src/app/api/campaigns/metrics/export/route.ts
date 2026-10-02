import { apiError, withAuth } from "@/lib/api";
import { metricsCsv } from "@/lib/campaign-metrics";
import { PeriodError } from "@/server/analytics/period";
import { campaignsDisabledResponse, campaignsEnabled } from "@/server/campaigns/flag";
import { getCampaignMetrics } from "@/server/campaigns/metrics";

export const dynamic = "force-dynamic";

/** Campañas v2 (PR 3) — Métricas del periodo en CSV: una fila por campaña y el total. */
export const GET = withAuth(
  async (session, req: Request) => {
    if (!(await campaignsEnabled(session.organizationId))) return campaignsDisabledResponse();
    const url = new URL(req.url);
    try {
      const m = await getCampaignMetrics(session.organizationId, {
        from: url.searchParams.get("from"),
        to: url.searchParams.get("to"),
        phoneNumberId: url.searchParams.get("phone"),
      });
      return new Response(metricsCsv(m), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="metricas-campanas-${m.period.from}-a-${m.period.to}.csv"`,
          "cache-control": "no-store",
        },
      });
    } catch (err) {
      if (err instanceof PeriodError) return apiError(422, "invalid_period", err.message);
      throw err;
    }
  },
  { permission: "campaigns.manage" }
);
