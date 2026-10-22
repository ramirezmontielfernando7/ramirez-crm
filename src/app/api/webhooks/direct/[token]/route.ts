import { logger } from "@/lib/log";
import { handleWebhookState } from "@/server/direct-connection/link";
import { parseState } from "@/server/direct-connection/evolution-api";
import { acceptsWebhooks } from "@/server/shutdown";

export const dynamic = "force-dynamic";

const log = logger("direct-connection");

type Params = { params: Promise<{ token: string }> };

/**
 * Conexión directa (PR 2) — El aviso de estado del dispositivo vinculado. El
 * token de la URL (de un solo uso por organización; en la base solo su hash)
 * decide de quién es. Un token que no existe responde 404 sin efectos. Solo
 * se lee el estado (`connection.update`); lo demás se ignora.
 */
export async function POST(req: Request, { params }: Params) {
  const { token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token)) return new Response(null, { status: 404 });
  if (!acceptsWebhooks()) return new Response(null, { status: 503, headers: { "Retry-After": "5" } });
  let body: { event?: unknown; data?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const event = typeof body.event === "string" ? body.event.toLowerCase().replace(/_/g, ".") : "";
  if (event !== "connection.update") return new Response(null, { status: 200 });
  const state = parseState(body.data);
  if (!state) return new Response(null, { status: 200 });
  try {
    const known = await handleWebhookState(token, state);
    return new Response(null, { status: known ? 200 : 404 });
  } catch (err) {
    log.error("no se pudo aplicar el aviso del dispositivo vinculado", { err });
    return new Response(null, { status: 500 });
  }
}
