import { protectedResourceMetadata } from "@/lib/ai-connector";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * 047 — Metadatos del recurso protegido (RFC 9728): la IA que recibe un 401
 * de `/api/mcp` lee aquí dónde iniciar sesión. Públicos y sin datos de
 * nadie. Responde en la raíz y con la ruta insertada (`…/api/mcp`).
 */
export async function GET(): Promise<Response> {
  return Response.json(protectedResourceMetadata(getEnv().APP_BASE_URL), {
    headers: { "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" },
  });
}
