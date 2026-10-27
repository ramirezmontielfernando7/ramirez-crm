import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { exchangeCode, refreshTokens } from "@/server/ai-connector/oauth";

export const dynamic = "force-dynamic";

/** Por IP: 60 por minuto (cada app renueva cada hora). */
const TOKEN_BUDGET = { windowMs: 60_000, max: 60 };

const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };

/** El cuerpo del token endpoint: formulario (lo que pide OAuth) o JSON. */
async function readParams(req: Request): Promise<URLSearchParams | null> {
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await req.json()) as Record<string, unknown>;
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) if (typeof v === "string") p.set(k, v);
      return p;
    }
    return new URLSearchParams(await req.text());
  } catch {
    return null;
  }
}

function oauthError(error: string, description: string, status = 400): Response {
  return Response.json({ error, error_description: description }, { status, headers: NO_STORE });
}

/**
 * 047 PR 3 — Token endpoint del conector de IA: cambia el código de un solo
 * uso (con PKCE) por llaves, y renueva rotando la de renovación. Clientes
 * públicos: sin secreto (`token_endpoint_auth_method: none`).
 */
export async function POST(req: Request): Promise<Response> {
  if (!checkRateLimit(`oauth-token:${clientIp(req.headers)}`, TOKEN_BUDGET).allowed) {
    return oauthError("slow_down", "Demasiadas solicitudes", 429);
  }
  const p = await readParams(req);
  if (!p) return oauthError("invalid_request", "Cuerpo no válido");
  const clientId = p.get("client_id") ?? "";
  const grant = p.get("grant_type");
  if (!clientId) return oauthError("invalid_client", "Falta client_id", 401);
  let out;
  if (grant === "authorization_code") {
    const code = p.get("code");
    const redirectUri = p.get("redirect_uri");
    const codeVerifier = p.get("code_verifier");
    if (!code || !redirectUri || !codeVerifier) return oauthError("invalid_request", "Faltan code, redirect_uri o code_verifier");
    out = await exchangeCode({ code, clientId, redirectUri, codeVerifier, resource: p.get("resource") });
  } else if (grant === "refresh_token") {
    const refreshToken = p.get("refresh_token");
    if (!refreshToken) return oauthError("invalid_request", "Falta refresh_token");
    out = await refreshTokens({ refreshToken, clientId });
  } else {
    return oauthError("unsupported_grant_type", "Solo authorization_code y refresh_token");
  }
  if ("error" in out) return oauthError(out.error, out.description);
  return Response.json(out, { headers: NO_STORE });
}
