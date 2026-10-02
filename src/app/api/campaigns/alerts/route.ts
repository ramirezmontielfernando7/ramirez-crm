import { withAuth } from "@/lib/api";
import { campaignsEnabled } from "@/server/campaigns/flag";
import { autoPausedCampaigns } from "@/server/campaigns/lifecycle";

export const dynamic = "force-dynamic";

/**
 * Campañas v2 — Campañas en pausa de seguridad (automática), para el aviso
 * de la app (Propietario y Coordinador). Sin el módulo: lista vacía.
 */
export const GET = withAuth(
  async (session) => {
    if (!(await campaignsEnabled(session.organizationId))) return Response.json({ paused: [] });
    const rows = await autoPausedCampaigns(session.organizationId);
    return Response.json({
      paused: rows.map((r) => ({ id: r.id, name: r.name, reason: r.pauseReason, resumeAt: r.resumeAt?.toISOString() ?? null })),
    });
  },
  { permission: "campaigns.manage" }
);
