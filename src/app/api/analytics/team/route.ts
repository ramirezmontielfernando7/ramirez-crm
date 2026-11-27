import { apiError, withAuth } from "@/lib/api";
import { PeriodError, periodFromRequest } from "@/server/analytics/period";
import { moduleOff } from "@/server/modules";
import { teamPanel } from "@/server/analytics/team";
import { getTeamSla } from "@/server/team-sla";

export const dynamic = "force-dynamic";

/** Productividad por asesor: solo quien ve a todo el equipo (`results.all`). */
export const GET = withAuth(async (session, req: Request) => {
  const off = await moduleOff(session.organizationId, "results");
  if (off) return off;
  try {
    const period = await periodFromRequest(session.organizationId, new URL(req.url));
    const limit = await getTeamSla(session.organizationId);
    return Response.json(await teamPanel(session.organizationId, period, limit));
  } catch (err) {
    if (err instanceof PeriodError) return apiError(422, "invalid_period", err.message);
    throw err;
  }
}, { permission: "results.all" });
