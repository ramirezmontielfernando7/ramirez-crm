import { withAuth } from "@/lib/api";
import { answer } from "@/server/mi-numero/http";
import { miNumeroOff } from "@/server/mi-numero/numbers";
import { teamNumbers } from "@/server/mi-numero/supervise";

export const dynamic = "force-dynamic";

/**
 * Mi número (046), PR 7 — Para quien supervisa (Propietario y Coordinador):
 * los chats de los números de la empresa y los chats de cliente de números
 * personales que su dueño deja pedir. Sin el complemento: 404.
 */
export const GET = withAuth(
  async (session) => {
    const off = await miNumeroOff(session.organizationId);
    if (off) return off;
    return answer(async () => Response.json(await teamNumbers(session.organizationId, session.userId)));
  },
  { permission: "mi_numero.manage" },
);
