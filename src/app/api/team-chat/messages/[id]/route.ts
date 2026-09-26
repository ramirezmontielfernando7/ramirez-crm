import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { TEAM_MESSAGE_MAX } from "@/lib/team-chat";
import { deleteMessage, editMessage, readMessage } from "@/server/team-chat/messages";
import { teamChatErrorResponse } from "@/server/team-chat/errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 026 — Un mensaje, con las menciones resueltas para quien pregunta (el
 * evento SSE viaja neutro). Hilo que no ve = 404.
 */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  try {
    return Response.json({ message: await readMessage(session, id) });
  } catch (err) {
    return teamChatErrorResponse(err, "leer mensaje");
  }
});

const editSchema = z.object({ body: z.string().max(TEAM_MESSAGE_MAX * 2) });

/**
 * 025 — Editar un mensaje: solo su autor, participando del hilo. La
 * supervisión nunca edita (403); un hilo que no ve es 404.
 */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, editSchema);
  if (!body.ok) return body.response;
  try {
    const { message } = await editMessage(session, id, body.data.body);
    return Response.json({ message });
  } catch (err) {
    return teamChatErrorResponse(err, "editar mensaje");
  }
});

/** Borrar (suave) un mensaje propio: queda "Mensaje eliminado" y el adjunto se borra. */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  try {
    const { message } = await deleteMessage(session, id);
    return Response.json({ message });
  } catch (err) {
    return teamChatErrorResponse(err, "borrar mensaje");
  }
});
