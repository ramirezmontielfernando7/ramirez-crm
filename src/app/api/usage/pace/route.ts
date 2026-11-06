import { withAuth } from "@/lib/api";
import { getAiPace } from "@/server/usage/pace";

export const dynamic = "force-dynamic";

/**
 * El ritmo de la IA del mes para la ventana de aviso del Propietario (qué
 * ventana toca, a qué ritmo, cuándo se acabaría). Solo porcentajes y fechas,
 * nunca dólares. Solo el Propietario (`usage.read`).
 */
export const GET = withAuth(async (session) => Response.json(await getAiPace(session.organizationId)), { permission: "usage.read" });
