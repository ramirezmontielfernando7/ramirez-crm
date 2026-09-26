import { requireSession, UnauthorizedError } from "@/lib/auth/session";
import { isTeamEvent, subscribe, type SseEvent } from "@/server/events/bus";
import { canSeeEvent, canSeeTeamEvent } from "@/server/events/visibility";

/**
 * Canal SSE de la bandeja (contrato sse.md).
 * Headers exactos + heartbeat ~25s para sobrevivir detrás de Caddy/Traefik.
 * El servidor no garantiza replay: el cliente hace catch-up con `since=`.
 */
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;
const encoder = new TextEncoder();

export async function GET(req: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return new Response("No autenticado", { status: 401 });
    }
    throw err;
  }
  const { organizationId, access } = session;

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup?.();
        }
      };

      send(`: conectado\n\n`);

      const write = (event: SseEvent) =>
        send(
          `event: ${event.type}\n` +
            `id: ${Date.now()}\n` +
            `data: ${JSON.stringify(event.data)}\n\n`
        );

      // 020: a un asesor solo le llega lo suyo. La visibilidad se resuelve
      // con una consulta, así que los eventos se encadenan para no llegar
      // desordenados; quien ve todo no paga nada.
      let queue = Promise.resolve();
      const unsubscribe = subscribe(organizationId, (event) => {
        // 025: el chat de equipo va por audiencia, también para quien ve
        // todo (el atajo de abajo NO aplica). Se decide en memoria.
        if (isTeamEvent(event)) {
          if (canSeeTeamEvent(access, event)) write(event);
          return;
        }
        if (access.seesAll) {
          write(event);
          return;
        }
        queue = queue
          .then(async () => {
            if (await canSeeEvent(access, event)) write(event);
          })
          .catch(() => {
            // Ante la duda no se reenvía: el cliente se pone al día con
            // su refetch normal.
          });
      });

      const heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ya cerrado
        }
      };

      req.signal.addEventListener("abort", () => cleanup?.());
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
