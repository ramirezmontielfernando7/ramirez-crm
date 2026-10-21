import { apiError, withAuth } from "@/lib/api";
import { parseInboxView } from "@/lib/campaign-inbox";
import { parseSubsetParam } from "@/lib/inbox-refresh";
import { parseLimit, parseListFilters, parseListStatus } from "@/lib/inbox-list";
import { decodeCursor } from "@/server/inbox/cursor";
import {
  countCampaignPending,
  listConversations,
  listConversationsPage,
  type AssignmentFilter,
} from "@/server/inbox/queries";

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
 *
 * Paso 2 (PR 2) — `?ids=cv_a,cv_b` y/o `?contactIds=ct_a` devuelven SOLO esos
 * chats, con la misma consulta y los mismos permisos que la lista: lo que no
 * vuelve, la sesión ya no lo ve en esa vista y la Bandeja lo quita.
 *
 * Fluidez PR 3 — `?limit=N` (y `&cursor=` para la siguiente) devuelve UNA
 * página con los filtros de la pantalla (`status`, `q`, `stage`, `tag`,
 * `assigned`, `channel`) y `nextCursor` (null = no hay más). Sin `limit`, la
 * lista entera como siempre (globo, menciones, guiones). Los contadores
 * viven en `GET /api/conversations/counts`.
 */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  const filter = parseFilter(url.searchParams.get("assigned"));
  const view = parseInboxView(url.searchParams.get("view"));
  const ids = parseSubsetParam(url.searchParams.get("ids"));
  const contactIds = parseSubsetParam(url.searchParams.get("contactIds"));
  if (ids === "invalid" || contactIds === "invalid") {
    return apiError(422, "invalid_ids", "ids o contactIds no válidos");
  }
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  if (limit === "invalid" || cursor === "invalid") {
    return apiError(422, "invalid_page", "limit o cursor no válidos");
  }
  if (limit !== null && !ids && !contactIds) {
    const page = await listConversationsPage(
      session.access,
      view,
      { ...parseListFilters(url.searchParams), status: parseListStatus(url.searchParams.get("status")) },
      { limit, cursor }
    );
    return Response.json(page);
  }
  const only = ids || contactIds ? { ids: ids ?? [], contactIds: contactIds ?? [] } : undefined;
  const conversations = await listConversations(
    session.access,
    since && !Number.isNaN(since.getTime()) ? since : undefined,
    filter,
    view,
    only
  );
  if (view === "campaigns") return Response.json({ conversations });
  const campaignPending = await countCampaignPending(session.access, filter);
  return Response.json({ conversations, campaignPending });
});
