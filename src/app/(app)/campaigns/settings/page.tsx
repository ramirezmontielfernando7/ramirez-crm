import { notFound } from "next/navigation";
import { CampaignSettingsForm } from "@/components/campaigns/campaign-settings";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { campaignsEnabled } from "@/server/campaigns/flag";

export const dynamic = "force-dynamic";

/** Campañas v2 — Ajustes de envío: pausa de seguridad y tarifas estimadas. */
export default async function CampaignSettingsPage() {
  const session = await requirePagePermission("campaigns.manage");
  if (!(await campaignsEnabled(session.organizationId))) notFound();
  return <CampaignSettingsForm />;
}
