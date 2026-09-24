import { forbidden, withAuth } from "@/lib/api";
import { resultsScope } from "@/server/analytics/scope";
import { getBranding } from "@/server/branding";
import { hygieneBlock } from "@/server/analytics/hygiene";

export const dynamic = "force-dynamic";

/** 019 — Higiene. Sin rango: describe el AHORA, no un periodo. */
export const GET = withAuth(async (session, req: Request) => {
  const who = resultsScope(session, new URL(req.url));
  if (!who.ok) return forbidden();
  const branding = await getBranding(session.organizationId);
  return Response.json(await hygieneBlock(who.scope, branding.currency));
});
