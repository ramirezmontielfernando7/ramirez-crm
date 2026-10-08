import { apiError } from "@/lib/api";
import { withPlatformAdmin } from "@/server/platform-admin/http";
import { getOrgUsageDetail, organizationExists } from "@/server/platform-admin/usage";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 036 (PR 4) — El consumo del mes de UNA organización (al abrir su fila en
 * /platform): IA por función y por agente, y almacenamiento aproximado por
 * categoría. Solo números, solo lectura; solo el administrador de plataforma
 * (404 a los demás).
 */
export const GET = withPlatformAdmin(async (_admin, _ip, _req, { params }: Params) => {
  const { id } = await params;
  if (!(await organizationExists(id))) return apiError(404, "not_found", "Organización no encontrada");
  return Response.json({ usage: await getOrgUsageDetail(id) });
});
