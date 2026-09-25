import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { NAV_MODES } from "@/lib/preferences";
import { getUserPreferences, saveUserPreferences } from "@/server/preferences";

export const dynamic = "force-dynamic";

/**
 * 022 — Preferencias de interfaz de QUIEN pide (nunca de otro): hoy, en qué
 * estado va el menú lateral (expandido, solo íconos u oculto). Por usuario y
 * en BD, así que siguen a la persona de un dispositivo a otro. `null` = volver
 * al default del rol. `navCollapsed` (dos estados) se sigue aceptando.
 */
export const GET = withAuth(async (session) => {
  return Response.json(await getUserPreferences(session.organizationId, session.userId));
});

const bodySchema = z
  .object({
    navMode: z.enum(NAV_MODES).nullable().optional(),
    navCollapsed: z.boolean().nullable().optional(),
  })
  .refine((b) => b.navMode !== undefined || b.navCollapsed !== undefined, {
    message: "Falta navMode",
  });

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const saved = await saveUserPreferences(session.organizationId, session.userId, body.data);
  return Response.json(saved);
});
