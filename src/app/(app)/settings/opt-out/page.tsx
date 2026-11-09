import { OptOutSettings } from "@/components/settings/opt-out-settings";
import { requirePagePermission } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

/** Ajustes → Bajas automáticas (ronda 3): las palabras de baja (STOP/BAJA) y su respuesta. */
export default async function OptOutSettingsPage() {
  await requirePagePermission("settings.manage");
  return (
    <div className="max-w-3xl space-y-5">
      <div className="space-y-1 max-lg:hidden">
        <h2 className="text-[22px] font-semibold tracking-tight">Bajas automáticas</h2>
        <p className="text-[13.5px] text-text-2">Quien escribe una palabra de baja deja de recibir campañas, y le contestamos solos.</p>
      </div>
      <OptOutSettings />
    </div>
  );
}
