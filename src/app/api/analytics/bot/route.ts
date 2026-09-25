import { apiError, forbidden, withAuth } from "@/lib/api";
import { resultsScope } from "@/server/analytics/scope";
import { PeriodError, periodFromRequest } from "@/server/analytics/period";
import { botBlock } from "@/server/analytics/bot";

export const dynamic = "force-dynamic";

/** 019 — El trabajo del agente. Las citas, solo con la bandera AGENDA. */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const who = resultsScope(session, url);
  if (!who.ok) return forbidden();
  try {
    const period = await periodFromRequest(session.organizationId, url);
    return Response.json(await botBlock(who.scope, period));
  } catch (err) {
    if (err instanceof PeriodError) {
      return apiError(422, "invalid_period", err.message);
    }
    throw err;
  }
}, { permission: "results.read" });
