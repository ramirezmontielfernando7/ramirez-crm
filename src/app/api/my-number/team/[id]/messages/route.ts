import { withAuth } from "@/lib/api";
import { answer } from "@/server/mi-numero/http";
import { MESSAGE_PAGE, messageCursorFrom } from "@/server/mi-numero/message-page";
import { miNumeroOff } from "@/server/mi-numero/numbers";
import { companyNumberChatMessages } from "@/server/mi-numero/supervise";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Mi número (046), PR 7 — Leer (solo lectura) un chat de un número de la empresa; queda anotado. */
export const GET = withAuth(
  async (session, req: Request, { params }: Params) => {
    const off = await miNumeroOff(session.organizationId);
    if (off) return off;
    const { id } = await params;
    return answer(async () => {
      // DF-15: por bloques; `more` = puede haber mensajes anteriores.
      const messages = await companyNumberChatMessages(session.organizationId, session.userId, id, messageCursorFrom(req.url));
      return Response.json({ messages, more: messages.length >= MESSAGE_PAGE });
    });
  },
  { permission: "mi_numero.manage" },
);
