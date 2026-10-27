import { LossReasonsClient } from "@/components/settings/loss-reasons-client";
import { requirePagePermission } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default async function LossReasonsSettingsPage() {
  // Quien edita el pipeline (la API ya responde 403 al resto).
  await requirePagePermission("pipeline.edit");
  return <LossReasonsClient />;
}
