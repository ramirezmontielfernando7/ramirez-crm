import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { campaignsDisabledResponse, campaignsEnabled } from "@/server/campaigns/flag";
import { getCampaignSettings, saveCampaignSettings } from "@/server/campaigns/settings";

export const dynamic = "force-dynamic";

/** Campañas v2 — Ajustes de envío (pausa de seguridad y tarifas estimadas). */
export const GET = withAuth(
  async (session) => {
    if (!(await campaignsEnabled(session.organizationId))) return campaignsDisabledResponse();
    return Response.json({ settings: await getCampaignSettings(session.organizationId) });
  },
  { permission: "campaigns.manage" }
);

const rate = z.number().min(0).max(100).optional();
const bodySchema = z.object({
  failRatePercent: z.number().int().min(1).max(100),
  failRateWindow: z.number().int().min(10).max(1000),
  pauseOnQualityRed: z.boolean(),
  usagePausePercent: z.number().int().min(1).max(100),
  rates: z.object({ marketing: rate, utility: rate, authentication: rate }).strict(),
  currency: z.string().regex(/^[A-Za-z]{3}$/, "Moneda de 3 letras (MXN, USD…)").nullable(),
  replyWindowHours: z.number().int().min(1).max(720),
});

export const PUT = withAuth(
  async (session, req: Request) => {
    if (!(await campaignsEnabled(session.organizationId))) return campaignsDisabledResponse();
    const body = await parseBody(req, bodySchema);
    if (!body.ok) return body.response;
    const rates = Object.fromEntries(
      Object.entries(body.data.rates).filter((e): e is [string, number] => typeof e[1] === "number")
    );
    const settings = await saveCampaignSettings(session.organizationId, session.userId, { ...body.data, rates });
    return Response.json({ settings });
  },
  { permission: "campaigns.manage" }
);
