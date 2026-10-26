import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { answer } from "@/server/mi-numero/http";
import {
  authorizeNumber,
  listTeamNumbers,
  miNumeroOff,
} from "@/server/mi-numero/numbers";

export const dynamic = "force-dynamic";

/**
 * Mi número (046), PR 3 — Los números del equipo: quién tiene uno, su estado
 * y quién puede recibir uno; autorizar a una persona. Propietario y
 * Coordinador (`mi_numero.manage`). Sin el complemento: 404. Nunca los chats.
 */
export const GET = withAuth(
  async (session) => {
    const off = await miNumeroOff(session.organizationId);
    if (off) return off;
    return Response.json(await listTeamNumbers(session.organizationId));
  },
  { permission: "mi_numero.manage" },
);

const body = z
  .object({
    userId: z.string().min(1),
    kind: z.enum(["personal", "empresa"]),
    label: z.string().trim().max(60).nullable().optional(),
  })
  .strict();

export const POST = withAuth(
  async (session, req: Request) => {
    const off = await miNumeroOff(session.organizationId);
    if (off) return off;
    const parsed = await parseBody(req, body);
    if (!parsed.ok) return parsed.response;
    return answer(async () => {
      const id = await authorizeNumber(
        session.organizationId,
        session.userId,
        parsed.data,
      );
      return Response.json({ id }, { status: 201 });
    });
  },
  { permission: "mi_numero.manage" },
);
