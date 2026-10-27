import { requireMcpToken } from "@/server/ai-connector/auth";
import { handleRpc, readRpcBody } from "@/server/ai-connector/mcp";

export const dynamic = "force-dynamic";

/**
 * 047 — Conector de IA: el servidor MCP remoto de Dashfort. Cada persona
 * conecta SU IA con su llave (Bearer) y la IA actúa como ella. Sin
 * complemento `conector_ia`, con el conector apagado o sin llave: 401/403,
 * nunca datos. Ver `src/server/ai-connector/`.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await requireMcpToken(req);
  if (!auth.ok) return auth.response;
  const read = await readRpcBody(req);
  if (!read.ok) return Response.json(read.error, { status: 400 });
  const reply = await handleRpc(read.body, auth);
  if (!reply) return new Response(null, { status: 202 });
  return Response.json(reply, { headers: { "cache-control": "no-store" } });
}

/** Sin streams del servidor (no hay notificaciones que empujar). */
export async function GET(): Promise<Response> {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}

/** Sin sesión que cerrar. */
export async function DELETE(): Promise<Response> {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
