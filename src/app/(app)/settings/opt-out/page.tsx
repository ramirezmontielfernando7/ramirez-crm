import { OptOutSettings } from "@/components/settings/opt-out-settings";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { SettingsHeader } from "@/components/settings/settings-header";

export const dynamic = "force-dynamic";

/** Ajustes → Bajas automáticas (ronda 3): las palabras de baja (STOP/BAJA) y su respuesta. */
export default async function OptOutSettingsPage() {
  await requirePagePermission("settings.manage");
  return (
    <div className="space-y-6">
      <SettingsHeader title="Bajas automáticas" description="Quien escribe una palabra de baja deja de recibir campañas, y le contestamos solos." />
      <OptOutSettings />
    </div>
  );
}
