import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { conectorIaOff } from "@/server/modules";
import { getConnectorSettings, saveConnectorSettings } from "@/server/ai-connector/settings";

export const dynamic = "force-dynamic";

/**
 * 047 PR 3 — Ajustes → IA conectada → Ajustes del conector: lo decide el
 * Propietario (encendido, roles, tope diario). Sin el complemento: 404.
 */
export const GET = withAuth(
  async (session) => {
    const off = await conectorIaOff(session.organizationId);
    if (off) return off;
    return Response.json({ settings: await getConnectorSettings(session.organizationId) });
  },
  { permission: "settings.manage" }
);

const putSchema = z.object({
  enabled: z.boolean(),
  allowedRoles: z.array(z.enum(["coordinador", "asesor"])).max(2),
  dailyMessageLimit: z.number().int().min(0).max(1000),
});

export const PUT = withAuth(
  async (session, req: Request) => {
    const off = await conectorIaOff(session.organizationId);
    if (off) return off;
    const parsed = await parseBody(req, putSchema);
    if (!parsed.ok) return parsed.response;
    await saveConnectorSettings(session.organizationId, session.userId, parsed.data);
    return Response.json({ settings: await getConnectorSettings(session.organizationId) });
  },
  { permission: "settings.manage" }
);
