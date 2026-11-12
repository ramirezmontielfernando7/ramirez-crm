import { WhoAnswersSettings } from "@/components/settings/who-answers-settings";
import { SettingsHeader } from "@/components/settings/settings-header";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { requireModulePage } from "@/server/modules/page";

export const dynamic = "force-dynamic";

/**
 * Ajustes → Quién contesta: el interruptor general de la IA y el «cerebro
 * externo» (tu propio bot). Antes vivían solo en la pantalla vieja /agent.
 */
export default async function WhoAnswersPage() {
  await requirePagePermission("agent.manage");
  await requireModulePage("agent");
  return (
    <div className="space-y-6">
      <SettingsHeader
        title="Quién contesta"
        description="Enciende o apaga la IA de tu negocio y revisa si tu propio bot (cerebro externo) también contesta."
      />
      <WhoAnswersSettings />
    </div>
  );
}
