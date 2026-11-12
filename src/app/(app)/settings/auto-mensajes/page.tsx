import { AutoRepliesSettings } from "@/components/settings/auto-replies-settings";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { SettingsHeader } from "@/components/settings/settings-header";

export const dynamic = "force-dynamic";

/** Ajustes → Mensajes automáticos (049): bienvenida, fuera de horario y aviso de chats olvidados. Sin IA. */
export default async function AutoRepliesSettingsPage() {
  await requirePagePermission("settings.manage");
  return (
    <div className="space-y-6">
      <SettingsHeader
        title="Mensajes automáticos"
        description="Saluda, avisa que estás cerrado y no dejes un chat sin respuesta. Sin IA y sin costo extra."
      />
      <AutoRepliesSettings />
    </div>
  );
}
