import { notFound } from "next/navigation";
import { CampaignSettingsForm } from "@/components/campaigns/campaign-settings";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { campaignsEnabled } from "@/server/campaigns/flag";
import { runWithOrganization } from "@/lib/request-context";
import { getBranding } from "@/server/branding";

export const dynamic = "force-dynamic";

/** Campañas v2 — Ajustes de envío: pausa de seguridad y tarifas estimadas. */
export default async function CampaignSettingsPage() {
  const session = await requirePagePermission("campaigns.manage");
  if (!(await campaignsEnabled(session.organizationId))) notFound();
  // White-label: el texto dice el nombre de la marca de ESTA organización.
  const branding = await runWithOrganization(session.organizationId, () => getBranding(session.organizationId));
  return <CampaignSettingsForm brandName={branding.name} />;
}
