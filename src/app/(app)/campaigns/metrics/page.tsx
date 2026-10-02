import { notFound } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { CampaignsTabs } from "@/components/campaigns/campaigns-tabs";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { campaignsEnabled } from "@/server/campaigns/flag";

export const dynamic = "force-dynamic";

/**
 * Campañas v2 — Pestaña Métricas. La ruta ya existe; los indicadores
 * (enviados, entregados, leídos, respuestas, costo estimado vs. reportado por
 * Meta) llegan en el PR 3.
 */
export default async function MetricsPage() {
  const session = await requirePagePermission("campaigns.manage");
  if (!(await campaignsEnabled(session.organizationId))) notFound();
  return (
    <div className="flex h-full flex-col">
      <CampaignsTabs />
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center" data-testid="metrics-soon">
        <BarChart3 className="h-8 w-8 text-text-3" strokeWidth={1.5} />
        <p className="text-sm font-medium">Las métricas llegan en la siguiente actualización</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Mientras tanto, el detalle de cada campaña muestra enviados, entregados, leídos y fallidos con su motivo.
        </p>
      </div>
    </div>
  );
}
