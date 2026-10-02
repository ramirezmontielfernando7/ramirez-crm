import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { campaignsDisabledResponse, campaignsEnabled } from "@/server/campaigns/flag";
import { campaignErrorResponse } from "@/server/campaigns/http";
import { launchCampaign } from "@/server/campaigns/service";
import { businessTimezone } from "@/server/analytics/period";
import { zonedWallClockToUtc } from "@/lib/time/slots";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    /** ISO con zona. */
    scheduledAt: z.string().datetime({ offset: true }).nullish(),
    /** Fecha y hora "de pared" en la zona horaria del negocio (lo que manda el asistente). */
    scheduledLocal: z
      .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/) })
      .nullish(),
  })
  .default({});

/**
 * 021 / Campañas v2 — Confirma y lanza el envío, ahora o a una hora
 * programada. Responde de inmediato (202); el envío corre en el despachador
 * del número y su avance llega por SSE (`campaign.progress`).
 */
export const POST = withAuth(
  async (session, req: Request, ctx: Params) => {
    if (!(await campaignsEnabled(session.organizationId))) return campaignsDisabledResponse();
    const { id } = await ctx.params;
    let scheduledAt: Date | null = null;
    if (Number(req.headers.get("content-length") ?? "0") > 0) {
      const body = await parseBody(req, bodySchema);
      if (!body.ok) return body.response;
      if (body.data?.scheduledLocal) {
        const tz = await businessTimezone(session.organizationId);
        scheduledAt = zonedWallClockToUtc(body.data.scheduledLocal.date, body.data.scheduledLocal.time, tz);
        if (!scheduledAt) return apiError(422, "invalid", "Fecha u hora de programación no válida");
      } else if (body.data?.scheduledAt) {
        scheduledAt = new Date(body.data.scheduledAt);
      }
    }
    try {
      return Response.json({ campaign: await launchCampaign(session.organizationId, id, { scheduledAt }) }, { status: 202 });
    } catch (err) {
      return campaignErrorResponse(err);
    }
  },
  { permission: "campaigns.manage" }
);
