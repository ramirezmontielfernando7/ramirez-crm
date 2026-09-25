import { notFound } from "next/navigation";
import { CampaignDetail } from "@/components/campaigns/campaign-detail";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { campaignsEnabled } from "@/server/campaigns/flag";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  if (!campaignsEnabled()) notFound();
  await requirePagePermission("campaigns.manage");
  const { id } = await params;
  return <CampaignDetail campaignId={id} />;
}
