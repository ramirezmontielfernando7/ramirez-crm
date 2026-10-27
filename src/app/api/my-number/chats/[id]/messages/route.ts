import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { answer } from "@/server/mi-numero/http";
import { myChatMessages } from "@/server/mi-numero/chats";
import { miNumeroOff } from "@/server/mi-numero/numbers";
import { sendFromMyNumber } from "@/server/mi-numero/send";
import { numberSendError } from "@/server/mi-numero/send-http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Mi número (046), PR 4 — Los mensajes de uno de MIS chats (abrirlo lo deja leído). */
export const GET = withAuth(async (session, _req: Request, { params }: Params) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  const { id } = await params;
  return answer(async () => Response.json({ messages: await myChatMessages(session.organizationId, session.userId, id) }));
});

const Body = z.object({ text: z.string().trim().min(1).max(4096) });

/** Mi número (046), PR 5 — Contestar uno de MIS chats por mi número. */
export const POST = withAuth(async (session, req: Request, { params }: Params) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(422, "invalid", "Escribe un mensaje (hasta 4096 caracteres).");
  return answer(async () => {
    try {
      const r = await sendFromMyNumber(session.organizationId, session.userId, id, { text: parsed.data.text });
      return Response.json({ messageId: r.messageId, ...(r.queuedUntil ? { queuedUntil: r.queuedUntil.toISOString() } : {}) }, { status: 201 });
    } catch (err) {
      return numberSendError(err);
    }
  });
});
