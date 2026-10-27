import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { registerClient, registerSchema } from "@/server/ai-connector/oauth";

export const dynamic = "force-dynamic";

/** Registros por IP: 20 cada 10 minutos (una app se registra una vez). */
const REGISTER_BUDGET = { windowMs: 10 * 60_000, max: 20 };

/**
 * 047 PR 3 — Registro dinámico de apps de IA (RFC 7591), para las que aún no
 * usan CIMD. Público como manda el estándar: registrar no da acceso a nada;
 * la persona todavía tiene que entrar y aceptar.
 */
export async function POST(req: Request): Promise<Response> {
  if (!checkRateLimit(`oauth-register:${clientIp(req.headers)}`, REGISTER_BUDGET).allowed) {
    return Response.json({ error: "rate_limited", error_description: "Demasiados registros" }, { status: 429 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid_client_metadata", error_description: "JSON no válido" }, { status: 400 });
  }
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "invalid_client_metadata", error_description: "Metadatos incompletos" }, { status: 400 });
  }
  const client = await registerClient(parsed.data);
  if (client === "invalid_redirect_uri") {
    return Response.json(
      { error: "invalid_redirect_uri", error_description: "Solo https, o http hacia localhost" },
      { status: 400 }
    );
  }
  return Response.json(
    {
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201, headers: { "cache-control": "no-store" } }
  );
}
