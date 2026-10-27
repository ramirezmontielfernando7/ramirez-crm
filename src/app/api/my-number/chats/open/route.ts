import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { openNumberChat } from "@/server/mi-numero/chats";
import { answer } from "@/server/mi-numero/http";
import { miNumeroOff } from "@/server/mi-numero/numbers";

export const dynamic = "force-dynamic";

const body = z.object({ phone: z.string().min(1).max(40), name: z.string().max(120).optional() }).strict();

/** Mi número — Abrir (o crear, privado) el chat de MI número con un teléfono que se buscó. */
export const POST = withAuth(async (session, req: Request) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  const parsed = await parseBody(req, body);
  if (!parsed.ok) return parsed.response;
  return answer(async () => Response.json(await openNumberChat(session.organizationId, session.userId, parsed.data)));
});
