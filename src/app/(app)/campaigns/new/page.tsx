import { notFound } from "next/navigation";
import { NewCampaign } from "@/components/campaigns/new-campaign";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { campaignsEnabled } from "@/server/campaigns/flag";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  if (!campaignsEnabled()) notFound();
  await requirePagePermission("campaigns.manage");
  return <NewCampaign />;
}
