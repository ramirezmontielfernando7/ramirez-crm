import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { ASSIGNMENT_MODES } from "@/lib/assignment-mode";
import { getAssignmentMode, setAssignmentMode } from "@/server/assignment/settings";

export const dynamic = "force-dynamic";

/** Cómo se reparte un lead nuevo: a mano o por turnos entre los asesores. */
export const GET = withAuth(async (session) => {
  return Response.json({ mode: await getAssignmentMode(session.organizationId) });
}, { permission: "assignment.manage" });

const putSchema = z.object({ mode: z.enum(ASSIGNMENT_MODES) });

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  return Response.json({ mode: await setAssignmentMode(session.organizationId, body.data.mode) });
}, { permission: "assignment.manage" });
