import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { DIRECT_TEXT, LIMIT_RANGES } from "@/lib/direct-connection";
import { limitsOf, saveDirectLimits } from "@/server/direct-connection/limits";
import { getDirectSettings } from "@/server/direct-connection/settings";
import { conexionDirectaOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/**
 * Conexión directa (PR 3) — Límites de envío de la «Configuración
 * avanzada». Permiso `direct_connection.limits` (Propietario; delegable).
 * Sin el complemento: 404 (cero rastro).
 */
export const GET = withAuth(
  async (session) => {
    const off = await conexionDirectaOff(session.organizationId);
    if (off) return off;
    const settings = await getDirectSettings(session.organizationId);
    return Response.json({ limits: limitsOf(settings), ranges: LIMIT_RANGES, hint: DIRECT_TEXT.limitsHint });
  },
  { permission: "direct_connection.limits" }
);

const schema = z
  .object({
    limitsEnabled: z.boolean(),
    minIntervalSeconds: z.number().int(),
    perChatPerMinute: z.number().int(),
    perHour: z.number().int(),
  })
  .strict();

export const PUT = withAuth(
  async (session, req: Request) => {
    const off = await conexionDirectaOff(session.organizationId);
    if (off) return off;
    const body = await parseBody(req, schema);
    if (!body.ok) return body.response;
    const saved = await saveDirectLimits(session.organizationId, body.data, session.userId);
    if (!saved.ok) return apiError(422, "invalid", saved.error);
    return Response.json({ limits: saved.limits });
  },
  { permission: "direct_connection.limits" }
);
