import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { campaignsDisabledResponse, campaignsEnabled } from "@/server/campaigns/flag";
import { campaignErrorResponse } from "@/server/campaigns/http";
import { sendCampaignTest } from "@/server/campaigns/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ phone: z.string().min(5).max(30) });

/**
 * Campañas v2 — Envío de prueba a un número propio. Queda en el chat de ese
 * número; NO cuenta en la campaña.
 */
export const POST = withAuth(
  async (session, req: Request, ctx: Params) => {
    if (!(await campaignsEnabled(session.organizationId))) return campaignsDisabledResponse();
    const { id } = await ctx.params;
    const body = await parseBody(req, bodySchema);
    if (!body.ok) return body.response;
    try {
      return Response.json({ test: await sendCampaignTest(session.organizationId, id, body.data.phone) });
    } catch (err) {
      return campaignErrorResponse(err);
    }
  },
  { permission: "campaigns.manage" }
);
