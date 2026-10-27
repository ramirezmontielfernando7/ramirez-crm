import { withAuth } from "@/lib/api";
import { answer } from "@/server/mi-numero/http";
import { listMyChats } from "@/server/mi-numero/chats";
import { miNumeroOff } from "@/server/mi-numero/numbers";

export const dynamic = "force-dynamic";

/**
 * Mi número (046), PR 4 — Los chats de MI número (la sesión decide de quién;
 * nunca los de otro). Sin el complemento: 404; sin número: 404.
 */
export const GET = withAuth(async (session) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  return answer(async () => Response.json(await listMyChats(session.organizationId, session.userId, session.access)));
});
