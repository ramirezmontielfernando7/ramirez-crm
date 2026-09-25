import { withAuth } from "@/lib/api";
import { campaignsDisabledResponse, campaignsEnabled } from "@/server/campaigns/flag";
import { campaignErrorResponse } from "@/server/campaigns/http";
import { launchCampaign } from "@/server/campaigns/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 021 — Confirma y lanza el envío. Responde de inmediato (202); el envío
 * corre en segundo plano y su avance llega por SSE (`campaign.progress`).
 */
export const POST = withAuth(
  async (session, _req: Request, ctx: Params) => {
    if (!campaignsEnabled()) return campaignsDisabledResponse();
    const { id } = await ctx.params;
    try {
      return Response.json({ campaign: await launchCampaign(session.organizationId, id) }, { status: 202 });
    } catch (err) {
      return campaignErrorResponse(err);
    }
  },
  { permission: "campaigns.manage" }
);
