import { withAuth } from "@/lib/api";
import { sharedChatMessages } from "@/server/mi-numero/access";
import { answer } from "@/server/mi-numero/http";
import { MESSAGE_PAGE, messageCursorFrom } from "@/server/mi-numero/message-page";
import { miNumeroOff } from "@/server/mi-numero/numbers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Mi número (046), PR 6 — Leer (solo lectura) el chat de un compañero que me dio acceso; queda en su bitácora. */
export const GET = withAuth(async (session, req: Request, { params }: Params) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  const { id } = await params;
  return answer(async () => {
    // DF-15: por bloques; `more` = puede haber mensajes anteriores.
    const messages = await sharedChatMessages(session.organizationId, session.userId, id, messageCursorFrom(req.url));
    return Response.json({ messages, more: messages.length >= MESSAGE_PAGE });
  });
});
