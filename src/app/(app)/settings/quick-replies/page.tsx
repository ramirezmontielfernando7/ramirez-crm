import { QuickRepliesClient } from "@/components/settings/quick-replies-client";
import { requirePagePermission } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default async function QuickRepliesSettingsPage() {
  // Propietario y Coordinador (la API ya responde 403 al resto).
  await requirePagePermission("templates.manage");
  return <QuickRepliesClient />;
}
