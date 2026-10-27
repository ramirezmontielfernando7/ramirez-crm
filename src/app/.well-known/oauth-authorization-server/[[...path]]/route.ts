import { authorizationServerMetadata } from "@/lib/ai-connector";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * 047 PR 3 — Metadatos del servidor de autorización (RFC 8414) del conector
 * de IA: dónde inicia sesión la persona, dónde se cambian los códigos y que
 * solo se acepta PKCE S256. Públicos y sin datos de nadie.
 */
export async function GET(): Promise<Response> {
  return Response.json(authorizationServerMetadata(getEnv().APP_BASE_URL), {
    headers: { "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" },
  });
}
