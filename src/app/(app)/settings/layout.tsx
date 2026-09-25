import { SettingsNav } from "@/components/settings/settings-nav";
import { SETTINGS_TAB_PERMISSION } from "@/lib/auth/page-guard";
import { can } from "@/lib/auth/permissions";
import { getSessionOrNull } from "@/lib/auth/session";
import { agendaEnabled } from "@/server/agenda/flag";
import { atribucionEnabled } from "@/server/attribution/flag";
import { isChannelEnabled } from "@/server/channels/enabled";
import { NavRevealButton } from "@/components/nav-mode";

// La bandera se lee en cada petición: si esto se resolviera al construir, la
// imagen quedaría con la agenda apagada para siempre y encenderla en la
// plataforma no haría nada.
export const dynamic = "force-dynamic";

export default async function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // 020: solo las pestañas que el rol puede abrir.
  const session = await getSessionOrNull();
  const allowed = Object.entries(SETTINGS_TAB_PERMISSION)
    .filter(([, permission]) => session && can(session, permission))
    .map(([tab]) => tab);
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3 sm:px-6 sm:py-4">
        <NavRevealButton />
        <h2 className="text-[17px] font-bold tracking-tight">Configuración</h2>
      </header>
      {/* En móvil las pestañas van arriba (en fila), no como columna lateral. */}
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <SettingsNav
          agenda={agendaEnabled()}
          atribucion={atribucionEnabled()}
          messenger={isChannelEnabled("messenger")}
          allowed={allowed}
        />
        <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
