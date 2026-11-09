import { notFound } from "next/navigation";
import { CampaignsClient } from "@/components/campaigns/campaigns-client";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { runWithOrganization } from "@/lib/request-context";
import { todayInTz } from "@/lib/time/slots";
import { businessTimezone } from "@/server/analytics/period";
import { campaignsEnabled } from "@/server/campaigns/flag";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const session = await requirePagePermission("campaigns.manage");
  // 021: apagada, la pantalla no existe (igual que sus rutas: 404). Desde la
  // Fase 3 (PR 3), apagada para ESTA organización.
  if (!(await campaignsEnabled(session.organizationId))) notFound();
  // «Este mes» se corta en la zona del negocio, igual que Métricas.
  const timezone = await runWithOrganization(session.organizationId, () => businessTimezone(session.organizationId));
  return <CampaignsClient today={todayInTz(new Date(), timezone)} />;
}
