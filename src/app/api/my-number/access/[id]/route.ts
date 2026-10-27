import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { decideAccess } from "@/server/mi-numero/access";
import { answer } from "@/server/mi-numero/http";
import { miNumeroOff } from "@/server/mi-numero/numbers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const Body = z.object({ action: z.enum(["accept", "reject", "revoke"]) });

/** Mi número (046), PR 6 — El dueño acepta, rechaza o quita un acceso a uno de SUS chats. */
export const PATCH = withAuth(async (session, req: Request, { params }: Params) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(422, "invalid", "Acción no válida.");
  return answer(async () => {
    await decideAccess(session.organizationId, session.userId, id, parsed.data.action);
    return new Response(null, { status: 204 });
  });
});
