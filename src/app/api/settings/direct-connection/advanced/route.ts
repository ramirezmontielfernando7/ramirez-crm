import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { DIRECT_TEXT, LIMIT_RANGES } from "@/lib/direct-connection";
import { advancedOf, saveAdvanced } from "@/server/direct-connection/advanced";
import { getDirectSettings } from "@/server/direct-connection/settings";
import { isOrgWithoutMeta } from "@/server/direct-connection/without-meta";
import { conexionDirectaOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/**
 * Conexión directa (PR 5) — «Avanzado» de Ajustes. Permiso
 * `direct_connection.limits` (Propietario; delegable). Sin el complemento:
 * 404 (cero rastro).
 */
export const GET = withAuth(
  async (session) => {
    const off = await conexionDirectaOff(session.organizationId);
    if (off) return off;
    const [settings, metaless] = await Promise.all([
      getDirectSettings(session.organizationId),
      isOrgWithoutMeta(session.organizationId),
    ]);
    // PR 6: sin Meta, la pantalla esconde lo que solo aplica con Meta (modo, regreso, ventana).
    return Response.json({ advanced: advancedOf(settings), ranges: LIMIT_RANGES, hint: DIRECT_TEXT.limitsHint, metaless });
  },
  { permission: "direct_connection.limits" }
);

const bodySchema = z
  .object({
    defaultMode: z.enum(["meta", "directa", "mixta"]),
    autoReturnToMeta: z.boolean(),
    preferMetaInWindow: z.boolean(),
    closedWindowMode: z.enum(["directa", "mixta"]),
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
    const body = await parseBody(req, bodySchema);
    if (!body.ok) return body.response;
    const saved = await saveAdvanced(session.organizationId, body.data, session.userId);
    if (!saved.ok) return apiError(422, "invalid", saved.error);
    return Response.json({ advanced: saved.advanced });
  },
  { permission: "direct_connection.limits" }
);
