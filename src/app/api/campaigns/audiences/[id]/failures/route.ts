import { withAuth } from "@/lib/api";
import { toCsv } from "@/lib/csv";
import { campaignsDisabledResponse, campaignsEnabled } from "@/server/campaigns/flag";
import { campaignErrorResponse } from "@/server/campaigns/http";
import { audienceFailures } from "@/server/campaigns/audiences";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Campañas v2 — Las filas que no entraron, como CSV (protegido contra
 * inyección de fórmulas por `toCsv`).
 */
export const GET = withAuth(
  async (session, _req: Request, ctx: Params) => {
    if (!(await campaignsEnabled(session.organizationId))) return campaignsDisabledResponse();
    const { id } = await ctx.params;
    try {
      const { failures } = await audienceFailures(session.organizationId, id);
      const body = toCsv(
        ["linea", "nombre", "numero", "motivo"],
        failures.map((f) => [f.line, f.name, f.phone, f.reason])
      );
      return new Response(body, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="audiencia-${id}-errores.csv"`,
          "cache-control": "no-store",
        },
      });
    } catch (err) {
      return campaignErrorResponse(err);
    }
  },
  { permission: "campaigns.manage" }
);
