import { withAuth } from "@/lib/api";
import { campaignsDisabledResponse, campaignsEnabled } from "@/server/campaigns/flag";
import { campaignErrorResponse } from "@/server/campaigns/http";
import { deleteDraft, getCampaign } from "@/server/campaigns/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 021 — Detalle con conteos (pendientes / enviados / fallidos). */
export const GET = withAuth(
  async (session, _req: Request, ctx: Params) => {
    if (!campaignsEnabled()) return campaignsDisabledResponse();
    const { id } = await ctx.params;
    try {
      return Response.json({ campaign: await getCampaign(session.organizationId, id) });
    } catch (err) {
      return campaignErrorResponse(err);
    }
  },
  { permission: "campaigns.manage" }
);

/** 021 — Borra un borrador. Una campaña enviada es registro: no se borra. */
export const DELETE = withAuth(
  async (session, _req: Request, ctx: Params) => {
    if (!campaignsEnabled()) return campaignsDisabledResponse();
    const { id } = await ctx.params;
    try {
      await deleteDraft(session.organizationId, id);
      return new Response(null, { status: 204 });
    } catch (err) {
      return campaignErrorResponse(err);
    }
  },
  { permission: "campaigns.manage" }
);
