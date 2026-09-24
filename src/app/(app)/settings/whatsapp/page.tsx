import { WhatsappWizard } from "@/components/settings/whatsapp-wizard";
import { requirePagePermission } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default async function WhatsappSettingsPage() {
  // 020: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  await requirePagePermission("settings.manage");
  return <WhatsappWizard />;
}
