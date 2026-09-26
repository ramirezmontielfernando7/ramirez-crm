import { withAuth } from "@/lib/api";
import { markRead } from "@/server/team-chat/messages";
import { teamChatErrorResponse } from "@/server/team-chat/errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 025 — Marca el hilo como leído. La supervisión no cambia nada (`marked: false`). */
export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  try {
    return Response.json({ marked: await markRead(session, id) });
  } catch (err) {
    return teamChatErrorResponse(err, "marcar leído");
  }
});
