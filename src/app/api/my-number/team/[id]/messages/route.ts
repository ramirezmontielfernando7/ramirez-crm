import { withAuth } from "@/lib/api";
import { answer } from "@/server/mi-numero/http";
import { miNumeroOff } from "@/server/mi-numero/numbers";
import { companyNumberChatMessages } from "@/server/mi-numero/supervise";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Mi número (046), PR 7 — Leer (solo lectura) un chat de un número de la empresa; queda anotado. */
export const GET = withAuth(
  async (session, _req: Request, { params }: Params) => {
    const off = await miNumeroOff(session.organizationId);
    if (off) return off;
    const { id } = await params;
    return answer(async () => Response.json({ messages: await companyNumberChatMessages(session.organizationId, session.userId, id) }));
  },
  { permission: "mi_numero.manage" },
);
