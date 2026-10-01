import { notFound } from "next/navigation";
import { CampaignDetail } from "@/components/campaigns/campaign-detail";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { campaignsEnabled } from "@/server/campaigns/flag";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("campaigns.manage");
  // Fase 3, PR 3: el módulo es de la organización. Apagado, no existe (404).
  if (!(await campaignsEnabled(session.organizationId))) notFound();
  const { id } = await params;
  return <CampaignDetail campaignId={id} />;
}
