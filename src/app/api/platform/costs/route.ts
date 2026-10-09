import { getCostReport } from "@/server/costs/report";
import { withPlatformAdmin } from "@/server/platform-admin/http";

export const dynamic = "force-dynamic";

/**
 * 036 (PR 3b) — Costo de IA del mes por organización: estimado (precios
 * capturados), real (reportado por OpenRouter) y proyección a fin de mes.
 * Solo números; solo el administrador de plataforma (404 a los demás).
 */
export const GET = withPlatformAdmin(async () => {
  return Response.json({ report: await getCostReport() });
});
