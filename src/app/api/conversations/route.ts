import { withAuth } from "@/lib/api";
import { listConversations, type AssignmentFilter } from "@/server/inbox/queries";

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

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  const conversations = await listConversations(
    session.access,
    since && !Number.isNaN(since.getTime()) ? since : undefined,
    parseFilter(url.searchParams.get("assigned"))
  );
  return Response.json({ conversations });
});
