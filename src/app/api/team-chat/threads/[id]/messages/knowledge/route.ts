import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { deliverKnowledgeEntry, KnowledgeDeliveryError } from "@/server/knowledge/deliver";
import { getKnowledge } from "@/server/knowledge/store";
import { threadAccess } from "@/server/team-chat/threads";
import { teamChatErrorResponse } from "@/server/team-chat/errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  entryId: z.string().min(1).max(64),
  mode: z.enum(["text", "file"]),
});

/**
 * 025 — Comparte una entrada de Conocimientos en un hilo del chat de equipo
 * (el destino `internal_chat` de 024). Cualquier rol, en un hilo donde pueda
 * escribir; ajeno = 404.
 */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  try {
    await threadAccess(session, id);
    const entry = await getKnowledge(session.organizationId, body.data.entryId);
    if (!entry) return apiError(404, "not_found", "Entrada no encontrada");
    const result = await deliverKnowledgeEntry({ kind: "internal_chat", session, threadId: id }, entry, body.data.mode);
    return Response.json({ messageId: result.messageId }, { status: 201 });
  } catch (err) {
    if (err instanceof KnowledgeDeliveryError) return apiError(422, err.code, err.message);
    return teamChatErrorResponse(err, "compartir conocimiento");
  }
});
