import { apiError, withAuth } from "@/lib/api";
import { peekAgentForConversation } from "@/server/agents/resolve";
import { getConversation } from "@/server/inbox/queries";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 031 (PR B) — «Atiende: …» de la Bandeja: el agente por etapa que atiende
 * esta conversación (`null` = el general). Solo lee; quien no ve la
 * conversación recibe 404, como en el resto de la Bandeja.
 */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const visible = await getConversation(session.access, id);
  if (!visible) return apiError(404, "not_found", "Conversación no encontrada");
  const agent = await peekAgentForConversation(session.organizationId, id);
  return Response.json({ agent });
});
