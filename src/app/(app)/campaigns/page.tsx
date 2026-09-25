import { notFound } from "next/navigation";
import { CampaignsClient } from "@/components/campaigns/campaigns-client";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { campaignsEnabled } from "@/server/campaigns/flag";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  // 021: apagada, la pantalla no existe (igual que sus rutas: 404).
  if (!campaignsEnabled()) notFound();
  await requirePagePermission("campaigns.manage");
  return <CampaignsClient />;
}
