import { seesAllChats } from "@/lib/db/tenant";
import { requireSession, sessionFromHeaders, UnauthorizedError } from "@/lib/auth/session";
import { logger } from "@/lib/log";
import { runWithOrganization } from "@/lib/request-context";
import { isAudienceEvent, subscribe, type SseEvent } from "@/server/events/bus";
import { canSeeEvent, canSeeTeamEvent } from "@/server/events/visibility";

/**
 * Canal SSE de la bandeja (contrato sse.md).
 * Headers exactos + heartbeat ~25s para sobrevivir detrás de Caddy/Traefik.
 * El servidor no garantiza replay: el cliente hace catch-up con `since=`.
 */
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;
/**
 * La conexión vive horas, pero la sesión con la que se abrió puede dejar de
 * valer (cerró sesión, la sacaron del equipo, le bajaron el rol, se suspendió
 * la organización). Cada minuto se vuelve a preguntar: si ya no vale, se
 * cierra; si cambió el rol, desde ahí solo le llega lo que hoy puede ver.
 */
const REVALIDATE_MS = 60_000;
const log = logger("sse");
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
  const { organizationId, userId } = session;
  let access = session.access;
  // Copia: las cabeceras de la petición se releen mientras viva el stream.
  const reqHeaders = new Headers(req.headers);

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
        // todo (el atajo de abajo NO aplica). Se decide en memoria. 046: lo
        // de un «Mi número», igual.
        if (isAudienceEvent(event)) {
          if (canSeeTeamEvent(access, event)) write(event);
          return;
        }
        if (seesAllChats(access)) {
          write(event);
          return;
        }
        // PR 3: la consulta de visibilidad va a nombre de la organización
        // de la sesión (fija `app.org_id`), sin transacción abierta: el
        // stream vive horas y no puede retener una conexión del pool.
        queue = queue
          .then(() =>
            runWithOrganization(organizationId, async () => {
              if (await canSeeEvent(access, event)) write(event);
            })
          )
          .catch((err: unknown) => {
            // Ante la duda no se reenvía: el cliente se pone al día con
            // su refetch normal.
            log.warn("no se pudo decidir la visibilidad de un evento", { org: organizationId, err });
          });
      });

      const heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);

      const revalidate = setInterval(() => {
        void sessionFromHeaders(reqHeaders)
          .then((now) => {
            if (!now || now.userId !== userId || now.organizationId !== organizationId) {
              cleanup?.();
              return;
            }
            access = now.access;
          })
          .catch((err: unknown) => {
            // La base no contestó: no se sabe. Se reintenta en el siguiente minuto.
            log.warn("no se pudo revalidar la sesión de un canal SSE", { org: organizationId, err });
          });
      }, REVALIDATE_MS);

      cleanup = () => {
        clearInterval(heartbeat);
        clearInterval(revalidate);
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
