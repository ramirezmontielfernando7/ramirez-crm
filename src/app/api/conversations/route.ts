import { withAuth } from "@/lib/api";
import { parseInboxView } from "@/lib/campaign-inbox";
import { countCampaignPending, listConversations, type AssignmentFilter } from "@/server/inbox/queries";

export const dynamic = "force-dynamic";

/**
 * `?assigned=mine|unassigned|<userId>` filtra la bandeja por quien atiende
 * (020). Solo cambia algo para quien ve todo: a un asesor el servidor ya lo
 * limita a lo suyo, mande lo que mande.
 */
function parseFilter(value: string | null): AssignmentFilter {
  if (!value || value === "all") return { kind: "all" };
  if (value === "mine") return { kind: "mine" };
  if (value === "unassigned") return { kind: "unassigned" };
  return { kind: "user", userId: value };
}

/**
 * 041 — `?view=campaigns` devuelve SOLO los chats de campaña sin respuesta
 * (la pestaña «Campañas»); sin `view`, la principal los deja fuera y trae su
 * cuántos en `campaignPending` (para el contador, sin bajar la lista).
 */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  const filter = parseFilter(url.searchParams.get("assigned"));
  const view = parseInboxView(url.searchParams.get("view"));
  const conversations = await listConversations(
    session.access,
    since && !Number.isNaN(since.getTime()) ? since : undefined,
    filter,
    view
  );
  if (view === "campaigns") return Response.json({ conversations });
  const campaignPending = await countCampaignPending(session.access, filter);
  return Response.json({ conversations, campaignPending });
});
