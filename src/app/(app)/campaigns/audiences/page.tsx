import { notFound } from "next/navigation";
import { AudiencesClient } from "@/components/campaigns/audiences-client";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { campaignsEnabled } from "@/server/campaigns/flag";

export const dynamic = "force-dynamic";

/** Campañas v2 — Pestaña Audiencias (bases .xlsx/.csv guardadas). */
export default async function AudiencesPage() {
  const session = await requirePagePermission("campaigns.manage");
  if (!(await campaignsEnabled(session.organizationId))) notFound();
  return <AudiencesClient />;
}
