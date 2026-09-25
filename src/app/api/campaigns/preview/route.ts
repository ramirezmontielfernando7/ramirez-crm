import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { previewAudience } from "@/server/campaigns/audience";
import { campaignsDisabledResponse, campaignsEnabled } from "@/server/campaigns/flag";
import { audienceSchema } from "@/server/campaigns/http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ audience: audienceSchema.default({}) });

/**
 * 021 — A cuántos les llegaría: elegibles (opt_in) y cuántos del filtro se
 * quedan fuera por no tener consentimiento. Mismo cálculo que el envío.
 */
export const POST = withAuth(
  async (session, req: Request) => {
    if (!campaignsEnabled()) return campaignsDisabledResponse();
    const body = await parseBody(req, bodySchema);
    if (!body.ok) return body.response;
    return Response.json({ preview: await previewAudience(session.organizationId, body.data.audience ?? {}) });
  },
  { permission: "campaigns.manage" }
);
