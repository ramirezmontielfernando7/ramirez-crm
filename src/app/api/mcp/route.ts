import { requireMcpToken } from "@/server/ai-connector/auth";
import { handleRpc, readRpcBody } from "@/server/ai-connector/mcp";

export const dynamic = "force-dynamic";

/**
 * 047 — Conector de IA: el servidor MCP remoto de Dashfort. Cada persona
 * conecta SU IA con su llave (Bearer) y la IA actúa como ella. Sin
 * complemento `conector_ia`, con el conector apagado o sin llave: 401/403,
 * nunca datos. Ver `src/server/ai-connector/`.
 *
 * CORS abierto: la llave viaja en `Authorization` (nunca en cookies), así que
 * dejar que una app de IA lo llame desde el navegador no abre nada nuevo.
 */
const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

function withCors(res: Response): Response {
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}

/** ¿El cliente solo acepta un stream (Streamable HTTP sin `application/json`)? */
function wantsStream(req: Request): boolean {
  const accept = (req.headers.get("accept") ?? "").toLowerCase();
  return accept.includes("text/event-stream") && !accept.includes("application/json") && !accept.includes("*/*");
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireMcpToken(req);
  if (!auth.ok) return withCors(auth.response);
  const read = await readRpcBody(req);
  if (!read.ok) return withCors(Response.json(read.error, { status: 400 }));
  const reply = await handleRpc(read.body, auth);
  if (!reply) return withCors(new Response(null, { status: 202 }));
  if (wantsStream(req)) {
    // Un solo evento con la respuesta y se cierra el stream.
    return withCors(
      new Response(`event: message\ndata: ${JSON.stringify(reply)}\n\n`, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
      })
    );
  }
  return withCors(Response.json(reply, { headers: { "cache-control": "no-store" } }));
}

/** Sin streams del servidor (no hay notificaciones que empujar). */
export async function GET(): Promise<Response> {
  return withCors(new Response(null, { status: 405, headers: { allow: "POST" } }));
}

/** Sin sesión que cerrar. */
export async function DELETE(): Promise<Response> {
  return withCors(new Response(null, { status: 405, headers: { allow: "POST" } }));
}

/** Preflight CORS (apps de IA que llaman desde el navegador). */
export async function OPTIONS(): Promise<Response> {
  return withCors(new Response(null, { status: 204 }));
}
