import { TemplatesClient } from "@/components/settings/templates-client";
import { requirePagePermission } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default async function TemplatesSettingsPage() {
  // 020: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  await requirePagePermission("templates.manage");
  return <TemplatesClient />;
}
