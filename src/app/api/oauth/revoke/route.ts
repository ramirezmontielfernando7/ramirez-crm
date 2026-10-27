import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { revokeByToken } from "@/server/ai-connector/oauth";

export const dynamic = "force-dynamic";

const REVOKE_BUDGET = { windowMs: 60_000, max: 30 };

/**
 * 047 PR 3 — Revocación (RFC 7009): la app cierra su conexión. Responde 200
 * siempre (no confirma si la llave existía).
 */
export async function POST(req: Request): Promise<Response> {
  if (!checkRateLimit(`oauth-revoke:${clientIp(req.headers)}`, REVOKE_BUDGET).allowed) {
    return Response.json({ error: "slow_down" }, { status: 429 });
  }
  const p = new URLSearchParams(await req.text().catch(() => ""));
  const token = p.get("token");
  if (token && token.length >= 24 && token.length <= 200) await revokeByToken(token);
  return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
}
