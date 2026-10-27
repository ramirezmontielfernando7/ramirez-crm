import { withAuth } from "@/lib/api";
import { overlapsFor } from "@/server/mi-numero/access";
import { answer } from "@/server/mi-numero/http";
import { miNumeroOff } from "@/server/mi-numero/numbers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Mi número (046), PR 6 — «También habla con…» de uno de MIS chats (solo nombre y fecha). */
export const GET = withAuth(async (session, _req: Request, { params }: Params) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  const { id } = await params;
  return answer(async () => Response.json({ overlaps: await overlapsFor(session.organizationId, session.userId, id) }));
});
