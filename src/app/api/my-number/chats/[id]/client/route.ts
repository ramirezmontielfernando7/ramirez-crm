import { withAuth } from "@/lib/api";
import { answer } from "@/server/mi-numero/http";
import { dismissClientPrompt, markClient, unmarkClient } from "@/server/mi-numero/chats";
import { miNumeroOff } from "@/server/mi-numero/numbers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Mi número (046), PR 4 — «Es cliente»: uno de MIS chats pasa al CRM (con «Compartir mis clientes» encendido). */
export const POST = withAuth(async (session, _req: Request, { params }: Params) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  const { id } = await params;
  return answer(async () => {
    await markClient(session.organizationId, session.userId, id);
    return new Response(null, { status: 204 });
  });
});

/** «No es cliente»: el chat vuelve a ser privado; no se borra nada (se guarda y reaparece al volver a marcar). */
export const DELETE = withAuth(async (session, _req: Request, { params }: Params) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  const { id } = await params;
  return answer(async () => {
    await unmarkClient(session.organizationId, session.userId, id);
    return new Response(null, { status: 204 });
  });
});

/** «¿Es cliente?» → «No»: solo esconde la pregunta en este chat. */
export const PUT = withAuth(async (session, _req: Request, { params }: Params) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  const { id } = await params;
  return answer(async () => {
    await dismissClientPrompt(session.organizationId, session.userId, id);
    return new Response(null, { status: 204 });
  });
});
