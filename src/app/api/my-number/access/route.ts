import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { accessOverview, requestAccess } from "@/server/mi-numero/access";
import { answer } from "@/server/mi-numero/http";
import { miNumeroOff } from "@/server/mi-numero/numbers";

export const dynamic = "force-dynamic";

/** Mi número (046), PR 6 — Solicitudes a mis chats, accesos que di, quién los vio y lo que me compartieron. */
export const GET = withAuth(async (session) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  return answer(async () => Response.json(await accessOverview(session.organizationId, session.userId)));
});

const Body = z.object({ from: z.string().min(1).max(64), target: z.string().min(1).max(64) });

/** Pedir ver el chat de un compañero con un cliente que los dos atienden (`from` = mi chat). */
export const POST = withAuth(async (session, req: Request) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(422, "invalid", "Falta el chat.");
  return answer(async () => {
    await requestAccess(session.organizationId, session.userId, parsed.data.from, parsed.data.target);
    return new Response(null, { status: 204 });
  });
});
