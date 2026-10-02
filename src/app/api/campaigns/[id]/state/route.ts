import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { campaignsDisabledResponse, campaignsEnabled } from "@/server/campaigns/flag";
import { campaignErrorResponse } from "@/server/campaigns/http";
import { setCampaignState } from "@/server/campaigns/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ action: z.enum(["pause", "resume", "cancel"]) });

/** Campañas v2 — Pausar, reanudar o cancelar. 409 si el estado no lo permite. */
export const POST = withAuth(
  async (session, req: Request, ctx: Params) => {
    if (!(await campaignsEnabled(session.organizationId))) return campaignsDisabledResponse();
    const { id } = await ctx.params;
    const body = await parseBody(req, bodySchema);
    if (!body.ok) return body.response;
    try {
      return Response.json({ campaign: await setCampaignState(session.organizationId, id, body.data.action) });
    } catch (err) {
      return campaignErrorResponse(err);
    }
  },
  { permission: "campaigns.manage" }
);
