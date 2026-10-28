import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getAdvisorNewChatsBlocked, setAdvisorNewChatsBlocked } from "@/server/messaging-settings";

export const dynamic = "force-dynamic";

/** 048 — «Chats nuevos de los asesores»: lo decide quien administra los ajustes. */
export const GET = withAuth(async (session) => {
  return Response.json({ blocked: await getAdvisorNewChatsBlocked(session.organizationId) });
}, { permission: "settings.manage" });

const putSchema = z.object({ blocked: z.boolean() });

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  await setAdvisorNewChatsBlocked(session.organizationId, body.data.blocked, session.userId);
  return Response.json({ blocked: body.data.blocked });
}, { permission: "settings.manage" });
