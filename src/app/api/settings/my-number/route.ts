import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { answer } from "@/server/mi-numero/http";
import {
  miNumeroOff,
  myNumber,
  updateMyNumber,
} from "@/server/mi-numero/numbers";

export const dynamic = "force-dynamic";

/**
 * Mi número (046), PR 3 — El número de QUIEN PIDE (nunca el de otro): sus
 * interruptores (si es personal), aceptar el aviso y aceptar que pase a ser
 * de la empresa. Cualquier rol con un número autorizado. Sin el complemento: 404.
 */
export const GET = withAuth(async (session) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  return Response.json({
    number: await myNumber(session.organizationId, session.userId),
  });
});

const body = z
  .object({
    shareClients: z.boolean().optional(),
    overlapNotice: z.boolean().optional(),
    allowViewRequests: z.boolean().optional(),
    aiReplies: z.boolean().optional(),
    clientByDefault: z.boolean().optional(),
    acceptNotice: z.literal(true).optional(),
    becomeCompany: z.literal(true).optional(),
  })
  .strict();

export const PATCH = withAuth(async (session, req: Request) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  const parsed = await parseBody(req, body);
  if (!parsed.ok) return parsed.response;
  return answer(async () => {
    await updateMyNumber(session.organizationId, session.userId, parsed.data);
    return Response.json({
      number: await myNumber(session.organizationId, session.userId),
    });
  });
});
