import { withAuth } from "@/lib/api";
import { answer } from "@/server/mi-numero/http";
import { miNumeroOff } from "@/server/mi-numero/numbers";
import { requestAccessAsSupervisor } from "@/server/mi-numero/supervise";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Mi número (046), PR 7 — Pedir ver un chat de cliente de un número personal (decide su dueño). */
export const POST = withAuth(
  async (session, _req: Request, { params }: Params) => {
    const off = await miNumeroOff(session.organizationId);
    if (off) return off;
    const { id } = await params;
    return answer(async () => {
      await requestAccessAsSupervisor(session.organizationId, session.userId, id);
      return new Response(null, { status: 204 });
    });
  },
  { permission: "mi_numero.manage" },
);
