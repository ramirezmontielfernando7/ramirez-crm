import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { MAX_TEAM_SLA_MINUTES, MIN_TEAM_SLA_MINUTES } from "@/lib/team-sla";
import { getTeamSla, saveTeamSla } from "@/server/team-sla";

export const dynamic = "force-dynamic";

/** Cuántos minutos tiene un asesor para contestar antes de contarlo como «tarde». */
export const GET = withAuth(async (session) => {
  return Response.json({ minutes: await getTeamSla(session.organizationId) });
}, { permission: "results.all" });

const putSchema = z.object({ minutes: z.number().int().min(MIN_TEAM_SLA_MINUTES).max(MAX_TEAM_SLA_MINUTES) });

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  return Response.json({ minutes: await saveTeamSla(session.organizationId, body.data.minutes) });
}, { permission: "settings.manage" });
