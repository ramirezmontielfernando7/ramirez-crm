import { withAuth } from "@/lib/api";
import { countUnread } from "@/server/inbox/queries";

export const dynamic = "force-dynamic";

/**
 * Total de no leídos de clientes para el globo del menú. Igual que la suma de
 * `unreadCount` de `GET /api/conversations` (mismo filtro de organización y de
 * asignación), sin bajar la lista.
 */
export const GET = withAuth(async (session) => {
  return Response.json({ unread: await countUnread(session.access) });
});
