import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { answer } from "@/server/mi-numero/http";
import {
  miNumeroOff,
  revokeNumber,
  updateTeamNumber,
} from "@/server/mi-numero/numbers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Mi número (046), PR 3 — Un número del equipo: tipo, nombre y (solo si es de
 * la empresa) sus interruptores; revocarlo. `mi_numero.manage`.
 */
const body = z
  .object({
    kind: z.enum(["personal", "empresa"]).optional(),
    label: z.string().trim().max(60).nullable().optional(),
    shareClients: z.boolean().optional(),
    overlapNotice: z.boolean().optional(),
    allowViewRequests: z.boolean().optional(),
    aiReplies: z.boolean().optional(),
    clientByDefault: z.boolean().optional(),
  })
  .strict();

export const PATCH = withAuth(
  async (session, req: Request, { params }: Params) => {
    const off = await miNumeroOff(session.organizationId);
    if (off) return off;
    const parsed = await parseBody(req, body);
    if (!parsed.ok) return parsed.response;
    const { id } = await params;
    return answer(async () => {
      await updateTeamNumber(session.organizationId, id, parsed.data);
      return new Response(null, { status: 204 });
    });
  },
  { permission: "mi_numero.manage" },
);

export const DELETE = withAuth(
  async (session, _req: Request, { params }: Params) => {
    const off = await miNumeroOff(session.organizationId);
    if (off) return off;
    const { id } = await params;
    return answer(async () => {
      await revokeNumber(session.organizationId, id);
      return new Response(null, { status: 204 });
    });
  },
  { permission: "mi_numero.manage" },
);
