import { apiError, withAuth } from "@/lib/api";
import { getDb } from "@/lib/db";
import { demoBlockReason, seedDemo } from "@/server/seed/demo";

export const dynamic = "force-dynamic";

/**
 * Carga el negocio demo (FR-075). Solo en una empresa realmente vacía (sin contactos, sin conocimiento y sin agente editado) — la
 * versión por script (`pnpm seed:demo`) permite recargar con --force.
 */
export const POST = withAuth(async (session) => {
  const db = getDb();
  const reason = await demoBlockReason(db, session.organizationId);
  if (reason) return apiError(409, "not_empty", reason);
  const result = await seedDemo(db, session.organizationId);
  return Response.json({ ok: true, ...result });
}, { permission: "settings.manage" });
