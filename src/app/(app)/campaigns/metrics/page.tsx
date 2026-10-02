import { notFound } from "next/navigation";
import { CampaignsTabs } from "@/components/campaigns/campaigns-tabs";
import { MetricsClient } from "@/components/campaigns/metrics-client";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { runWithOrganization } from "@/lib/request-context";
import { todayInTz } from "@/lib/time/slots";
import { businessTimezone } from "@/server/analytics/period";
import { campaignsEnabled } from "@/server/campaigns/flag";

export const dynamic = "force-dynamic";

/**
 * Campañas v2 (PR 3) — Pestaña Métricas. Zona y "hoy" del negocio se
 * resuelven aquí (como Resultados) para que los atajos del periodo coincidan
 * con el servidor. Los datos los pide el cliente a `/api/campaigns/metrics`.
 */
export default async function MetricsPage() {
  const session = await requirePagePermission("campaigns.manage");
  if (!(await campaignsEnabled(session.organizationId))) notFound();
  const timezone = await runWithOrganization(session.organizationId, () => businessTimezone(session.organizationId));
  return (
    <div className="flex h-full flex-col">
      <CampaignsTabs />
      <MetricsClient today={todayInTz(new Date(), timezone)} timezone={timezone} />
    </div>
  );
}
