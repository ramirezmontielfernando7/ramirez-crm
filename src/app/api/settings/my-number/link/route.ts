import { withAuth } from "@/lib/api";
import { answer, miNumeroError } from "@/server/mi-numero/http";
import {
  miNumeroOff,
  myLinkStatus,
  startMyLink,
  unlinkMine,
} from "@/server/mi-numero/numbers";

export const dynamic = "force-dynamic";

/**
 * Mi número (046), PR 3 — Vincular MI número por QR, ver su estado y
 * desvincularlo. Solo su dueño (la sesión decide de quién es), y para
 * vincular, con el aviso aceptado. Nunca devuelve el servidor ni su llave.
 */
export const GET = withAuth(async (session) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  return answer(async () =>
    Response.json({
      connection: await myLinkStatus(session.organizationId, session.userId),
    }),
  );
});

export const POST = withAuth(async (session) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  return answer(async () => {
    const r = await startMyLink(session.organizationId, session.userId);
    if (!r.ok) return miNumeroError(r.error);
    return Response.json({ status: r.status, qr: r.qr });
  });
});

export const DELETE = withAuth(async (session) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  return answer(async () => {
    const r = await unlinkMine(session.organizationId, session.userId);
    if (!r.ok) return miNumeroError(r.error);
    return new Response(null, { status: 204 });
  });
});
