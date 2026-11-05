import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { CATALOG_SCOPES } from "@/lib/plan-catalog";
import { requestPlanChange } from "@/server/plan-catalog/request";

export const dynamic = "force-dynamic";

const schema = z.object({ plan: z.enum(CATALOG_SCOPES), billing: z.enum(["monthly", "yearly"]) }).strict();

/**
 * «Quiero este plan»: el Propietario avisa a la plataforma (cobro manual, sin
 * pasarela). Máximo 3 solicitudes por hora por organización. Solo el
 * Propietario (`usage.read`).
 */
export const POST = withAuth(
  async (session, req: Request) => {
    const body = await parseBody(req, schema);
    if (!body.ok) return body.response;
    const limit = checkRateLimit(`plan-request:${session.organizationId}`, { windowMs: 60 * 60_000, max: 3 });
    if (!limit.allowed) return apiError(429, "plan_request_rate_limited", "Ya enviaste varias solicitudes. Te contactamos pronto.");
    await requestPlanChange({
      organizationId: session.organizationId,
      userId: session.userId,
      plan: body.data.plan,
      billing: body.data.billing,
      ip: clientIp(req.headers),
    });
    return Response.json({ ok: true });
  },
  { permission: "usage.read" }
);
