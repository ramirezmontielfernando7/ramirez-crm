import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { setChatAi } from "@/server/mi-numero/chats";
import { answer } from "@/server/mi-numero/http";
import { miNumeroOff } from "@/server/mi-numero/numbers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const Body = z.object({ on: z.boolean() }).strict();

/** Mi número (046), PR 8 — Pausar o reanudar la IA en uno de MIS chats de cliente. */
export const PUT = withAuth(async (session, req: Request, { params }: Params) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(422, "invalid", "Falta si la IA queda encendida.");
  const { id } = await params;
  return answer(async () => {
    await setChatAi(session.organizationId, session.userId, id, parsed.data.on);
    return new Response(null, { status: 204 });
  });
});
