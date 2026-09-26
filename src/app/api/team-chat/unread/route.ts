import { withAuth } from "@/lib/api";
import { unreadTotal } from "@/server/team-chat/threads";
import { teamChatErrorResponse } from "@/server/team-chat/errors";

export const dynamic = "force-dynamic";

/** 025 — Total de no leídos del chat de equipo (el globo del menú). La supervisión no suma. */
export const GET = withAuth(async (session) => {
  try {
    return Response.json({ unread: await unreadTotal(session) });
  } catch (err) {
    return teamChatErrorResponse(err, "contar no leídos");
  }
});
