import { apiError, forbidden, withAuth } from "@/lib/api";
import { resultsScope } from "@/server/analytics/scope";
import { PeriodError, periodFromRequest } from "@/server/analytics/period";
import { adsBlock } from "@/server/analytics/ads";

export const dynamic = "force-dynamic";

/**
 * 019 — De dónde llegan: conversaciones, prospectos y ventas por origen y por
 * anuncio. Solo conteos: sin gasto, sin costo, sin retorno (spec 019, D1-D2).
 */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const who = resultsScope(session, url);
  if (!who.ok) return forbidden();
  try {
    const period = await periodFromRequest(session.organizationId, url);
    return Response.json(await adsBlock(who.scope, period));
  } catch (err) {
    if (err instanceof PeriodError) {
      return apiError(422, "invalid_period", err.message);
    }
    throw err;
  }
});
