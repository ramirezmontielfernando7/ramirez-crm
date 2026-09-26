import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { listThreads, openDirect } from "@/server/team-chat/threads";
import { teamChatErrorResponse } from "@/server/team-chat/errors";

export const dynamic = "force-dynamic";

/**
 * 025 — La lista del chat de equipo de quien pregunta: avisos, sus directos y
 * grupos, con no leídos. Con la supervisión encendida, el Propietario ve
 * además los ajenos (marcados `oversight`, sin sumar a su badge).
 * Visibilidad por MEMBRESÍA, no por `scope.all`.
 */
export const GET = withAuth(async (session) => {
  try {
    return Response.json(await listThreads(session));
  } catch (err) {
    return teamChatErrorResponse(err, "listar hilos");
  }
});

const directSchema = z.object({ userId: z.string().min(1).max(64) });

/** Abre (o reutiliza) un directo con otra persona de la organización. */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, directSchema);
  if (!body.ok) return body.response;
  try {
    const id = await openDirect(session, body.data.userId);
    return Response.json({ threadId: id }, { status: 201 });
  } catch (err) {
    return teamChatErrorResponse(err, "abrir directo");
  }
});
