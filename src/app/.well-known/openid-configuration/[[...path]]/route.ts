import { authorizationServerMetadata } from "@/lib/ai-connector";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Algunas apps (ChatGPT) prueban primero el descubrimiento estilo OpenID.
 * Se responden los mismos metadatos de OAuth del conector de IA.
 */
export async function GET(): Promise<Response> {
  return Response.json(authorizationServerMetadata(getEnv().APP_BASE_URL), {
    headers: { "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" },
  });
}
