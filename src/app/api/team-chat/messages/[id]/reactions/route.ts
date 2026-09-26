import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { setReaction } from "@/server/team-chat/messages";
import { teamChatErrorResponse } from "@/server/team-chat/errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({ emoji: z.string().min(1).max(16) });

/** 025 — Poner una reacción propia (idempotente). La supervisión no reacciona. */
export const PUT = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  try {
    const { message } = await setReaction(session, id, body.data.emoji, true);
    return Response.json({ message });
  } catch (err) {
    return teamChatErrorResponse(err, "reaccionar");
  }
});

/** Quitar una reacción propia. */
export const DELETE = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  try {
    const { message } = await setReaction(session, id, body.data.emoji, false);
    return Response.json({ message });
  } catch (err) {
    return teamChatErrorResponse(err, "quitar reacción");
  }
});
