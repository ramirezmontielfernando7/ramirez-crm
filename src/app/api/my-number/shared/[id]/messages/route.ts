import { withAuth } from "@/lib/api";
import { sharedChatMessages } from "@/server/mi-numero/access";
import { answer } from "@/server/mi-numero/http";
import { miNumeroOff } from "@/server/mi-numero/numbers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Mi número (046), PR 6 — Leer (solo lectura) el chat de un compañero que me dio acceso; queda en su bitácora. */
export const GET = withAuth(async (session, _req: Request, { params }: Params) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  const { id } = await params;
  return answer(async () => Response.json({ messages: await sharedChatMessages(session.organizationId, session.userId, id) }));
});
