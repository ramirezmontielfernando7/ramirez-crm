import { notFound } from "next/navigation";
import { CampaignsClient } from "@/components/campaigns/campaigns-client";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { campaignsEnabled } from "@/server/campaigns/flag";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const session = await requirePagePermission("campaigns.manage");
  // 021: apagada, la pantalla no existe (igual que sus rutas: 404). Desde la
  // Fase 3 (PR 3), apagada para ESTA organización.
  if (!(await campaignsEnabled(session.organizationId))) notFound();
  return <CampaignsClient />;
}
