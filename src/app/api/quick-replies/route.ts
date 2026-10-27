import { apiError, parseBody, withAuth } from "@/lib/api";
import { quickReplySchema } from "@/lib/quick-replies";
import { createQuickReply, listQuickReplies } from "@/server/quick-replies/store";

export const dynamic = "force-dynamic";

/** Las respuestas rápidas del negocio: las usa todo el equipo desde el chat. */
export const GET = withAuth(async (session) => {
  return Response.json({ replies: await listQuickReplies(session.organizationId) });
});

export const POST = withAuth(
  async (session, req: Request) => {
    const body = await parseBody(req, quickReplySchema);
    if (!body.ok) return body.response;
    const reply = await createQuickReply(session.organizationId, session.userId, body.data);
    if (reply === "duplicate") return apiError(409, "duplicate", `Ya hay una respuesta con el atajo /${body.data.shortcut}`);
    return Response.json({ reply }, { status: 201 });
  },
  { permission: "templates.manage" }
);
