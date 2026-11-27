import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { CHAT_VIEWS } from "@/lib/chat-visibility";
import { getChatView, saveChatView } from "@/server/chat-visibility";

export const dynamic = "force-dynamic";

/** Qué chats de clientes ve un asesor: lo decide quien administra los ajustes. */
export const GET = withAuth(async (session) => {
  return Response.json({ view: await getChatView(session.organizationId) });
}, { permission: "settings.manage" });

const putSchema = z.object({ view: z.enum(CHAT_VIEWS) });

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  return Response.json({ view: await saveChatView(session.organizationId, body.data.view) });
}, { permission: "settings.manage" });
