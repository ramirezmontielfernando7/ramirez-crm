import { withAuth } from "@/lib/api";
import { answer } from "@/server/mi-numero/http";
import { myChatMessages } from "@/server/mi-numero/chats";
import { miNumeroOff } from "@/server/mi-numero/numbers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Mi número (046), PR 4 — Los mensajes de uno de MIS chats (abrirlo lo deja leído). */
export const GET = withAuth(async (session, _req: Request, { params }: Params) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  const { id } = await params;
  return answer(async () => Response.json({ messages: await myChatMessages(session.organizationId, session.userId, id) }));
});
