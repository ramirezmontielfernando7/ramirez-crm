import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getUserPreferences, saveUserPreferences } from "@/server/preferences";

export const dynamic = "force-dynamic";

/**
 * 022 — Preferencias de interfaz de QUIEN pide (nunca de otro): hoy, si el
 * menú lateral va colapsado. Por usuario y en BD, así que siguen a la persona
 * de un dispositivo a otro. `null` = volver al default del rol.
 */
export const GET = withAuth(async (session) => {
  return Response.json(await getUserPreferences(session.organizationId, session.userId));
});

const bodySchema = z.object({ navCollapsed: z.boolean().nullable() });

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  await saveUserPreferences(session.organizationId, session.userId, body.data);
  return Response.json(body.data);
});
