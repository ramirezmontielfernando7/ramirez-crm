import { apiError, forbidden, withAuth } from "@/lib/api";
import { resultsScope } from "@/server/analytics/scope";
import { getBranding } from "@/server/branding";
import { PeriodError, periodFromRequest } from "@/server/analytics/period";
import { salesBlock } from "@/server/analytics/sales";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/** 019 — Ventas y embudo del periodo (`?from=AAAA-MM-DD&to=AAAA-MM-DD`). */
export const GET = withAuth(async (session, req: Request) => {
  const off = await moduleOff(session.organizationId, "results");
  if (off) return off;
  const url = new URL(req.url);
  const who = resultsScope(session, url);
  if (!who.ok) return forbidden();
  try {
    const [period, branding] = await Promise.all([
      periodFromRequest(session.organizationId, url),
      getBranding(session.organizationId),
    ]);
    return Response.json(
      await salesBlock(who.scope, period, branding.currency)
    );
  } catch (err) {
    if (err instanceof PeriodError) {
      return apiError(422, "invalid_period", err.message);
    }
    throw err;
  }
}, { permission: "results.read" });
