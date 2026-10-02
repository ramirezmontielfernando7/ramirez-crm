import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { campaignsDisabledResponse, campaignsEnabled } from "@/server/campaigns/flag";
import { audienceSchema, campaignErrorResponse, variableSchema } from "@/server/campaigns/http";
import { previewCampaign } from "@/server/campaigns/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  audience: audienceSchema.default({}),
  templateId: z.string().min(1).optional(),
  variables: z.array(variableSchema).max(20).optional(),
});

/**
 * 021 / Campañas v2 — Paso 3 del asistente: cuántos recibirán, cuántos se
 * excluyen y por qué, costo ESTIMADO y margen frente al límite del número.
 * Mismo cálculo que el envío.
 */
export const POST = withAuth(
  async (session, req: Request) => {
    if (!(await campaignsEnabled(session.organizationId))) return campaignsDisabledResponse();
    const body = await parseBody(req, bodySchema);
    if (!body.ok) return body.response;
    try {
      const preview = await previewCampaign(session.organizationId, {
        audience: body.data.audience ?? {},
        templateId: body.data.templateId ?? null,
        variables: body.data.variables,
      });
      return Response.json({ preview });
    } catch (err) {
      return campaignErrorResponse(err);
    }
  },
  { permission: "campaigns.manage" }
);
