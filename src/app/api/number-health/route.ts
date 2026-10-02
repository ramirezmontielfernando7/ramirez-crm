import { apiError, withAuth } from "@/lib/api";
import { getHealthSummary, readRecently, refreshPhoneHealth } from "@/server/whatsapp/health";

export const dynamic = "force-dynamic";

/**
 * Campañas v2 (PR 1) — Salud del número de WhatsApp de la organización.
 * GET: lo guardado (nunca consulta a Meta en vivo). POST: "Actualizar",
 * una lectura nueva de Meta, a lo más una por minuto por organización.
 */
export const GET = withAuth(async (session) => {
  return Response.json(await getHealthSummary(session.organizationId));
}, { permission: "number_health.read" });

const REFRESH_EVERY_MS = 60_000;

export const POST = withAuth(async (session) => {
  if (await readRecently(session.organizationId, REFRESH_EVERY_MS)) {
    return apiError(429, "too_soon", "Se actualizó hace menos de un minuto; espera un momento");
  }
  const r = await refreshPhoneHealth(session.organizationId, "manual");
  if (!r.ok) {
    const status = r.error === "meta_unavailable" ? 503 : r.error === "meta_error" ? 422 : 409;
    return apiError(status, r.error, r.message);
  }
  return Response.json(await getHealthSummary(session.organizationId));
}, { permission: "number_health.read" });
