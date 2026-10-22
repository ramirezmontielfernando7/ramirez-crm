import { getModelsInUse } from "@/server/costs/models";
import { withPlatformAdmin } from "@/server/platform-admin/http";

export const dynamic = "force-dynamic";

/**
 * Qué modelo usa cada función (principal, juez, análisis, embeddings) según
 * las variables de entorno de esta instancia. Nunca llaves: del proveedor
 * solo el dominio, y de la llave solo si existe. Solo el administrador de
 * plataforma (404 a los demás).
 */
export const GET = withPlatformAdmin(async () => {
  return Response.json({ models: getModelsInUse() });
});
