import { withAuth } from "@/lib/api";
import { campaignsDisabledResponse, campaignsEnabled } from "@/server/campaigns/flag";
import { campaignErrorResponse } from "@/server/campaigns/http";
import { deleteAudience } from "@/server/campaigns/audiences";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Campañas v2 — Borra la base guardada (sus contactos y la etiqueta se quedan). */
export const DELETE = withAuth(
  async (session, _req: Request, ctx: Params) => {
    if (!(await campaignsEnabled(session.organizationId))) return campaignsDisabledResponse();
    const { id } = await ctx.params;
    try {
      await deleteAudience(session.organizationId, id);
      return new Response(null, { status: 204 });
    } catch (err) {
      return campaignErrorResponse(err);
    }
  },
  { permission: "campaigns.manage" }
);
