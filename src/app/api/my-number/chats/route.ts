import { withAuth } from "@/lib/api";
import { answer } from "@/server/mi-numero/http";
import { listMyChats } from "@/server/mi-numero/chats";
import { miNumeroOff } from "@/server/mi-numero/numbers";

export const dynamic = "force-dynamic";

/**
 * Mi número (046), PR 4 — Los chats de MI número (la sesión decide de quién;
 * nunca los de otro). Sin el complemento: 404; sin número: 404.
 */
export const GET = withAuth(async (session, req: Request) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  // DF-15: `?limit=` (los más recientes) y `?q=` (buscar entre todos, en el servidor).
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit")) || undefined;
  const q = url.searchParams.get("q");
  return answer(async () => Response.json(await listMyChats(session.organizationId, session.userId, session.access, { limit, q })));
});
