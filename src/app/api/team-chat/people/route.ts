import { withAuth } from "@/lib/api";
import { listPeople } from "@/server/team-chat/people";
import { teamChatErrorResponse } from "@/server/team-chat/errors";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/** 025 — Quién está en el equipo (nombre y rol), para abrir un directo o armar un grupo. */
export const GET = withAuth(async (session) => {
  const off = await moduleOff(session.organizationId, "team_chat");
  if (off) return off;
  try {
    return Response.json({ people: await listPeople(session.organizationId), me: session.userId });
  } catch (err) {
    return teamChatErrorResponse(err, "listar equipo");
  }
});
