import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { campaignsDisabledResponse, campaignsEnabled } from "@/server/campaigns/flag";
import { audienceSchema, campaignErrorResponse, variableSchema } from "@/server/campaigns/http";
import { createCampaign, listCampaigns } from "@/server/campaigns/service";

export const dynamic = "force-dynamic";

/** 021 — Campañas del negocio, la más reciente primero. */
export const GET = withAuth(
  async (session) => {
    if (!campaignsEnabled()) return campaignsDisabledResponse();
    return Response.json({ campaigns: await listCampaigns(session.organizationId) });
  },
  { permission: "campaigns.manage" }
);

const createSchema = z.object({
  name: z.string().max(200),
  templateId: z.string().min(1),
  variables: z.array(variableSchema).max(20).default([]),
  audience: audienceSchema.default({}),
});

/** 021 — Crea la campaña como BORRADOR. Enviar es otro paso (`/send`). */
export const POST = withAuth(
  async (session, req: Request) => {
    if (!campaignsEnabled()) return campaignsDisabledResponse();
    const body = await parseBody(req, createSchema);
    if (!body.ok) return body.response;
    try {
      const campaign = await createCampaign({
        organizationId: session.organizationId,
        userId: session.userId,
        name: body.data.name,
        templateId: body.data.templateId,
        variables: body.data.variables ?? [],
        audience: body.data.audience ?? {},
      });
      return Response.json({ campaign }, { status: 201 });
    } catch (err) {
      return campaignErrorResponse(err);
    }
  },
  { permission: "campaigns.manage" }
);
