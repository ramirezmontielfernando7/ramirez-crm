import { NavigationSettingsClient } from "@/components/settings/navigation-settings";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { orgHasCustomNav } from "@/server/modules";

export const dynamic = "force-dynamic";

/**
 * 030 (PR 4) — el menú de cada rol. Solo el Propietario y solo si la
 * plataforma encendió `custom_nav` para esta organización; la API valida
 * igual. Fase D: ya no es una pestaña suelta sino una subpestaña de
 * Personalización, y apagado explica por qué no está en vez de desaparecer.
 */
export default async function NavigationSettingsPage() {
  const session = await requirePagePermission("settings.manage");
  if (!(await orgHasCustomNav(session.organizationId))) {
    return (
      <div className="max-w-xl space-y-1" data-testid="nav-unavailable">
        <h3 className="text-[15px] font-semibold">Navegación no disponible</h3>
        <p className="text-[13.5px] text-text-2">
          Disponible cuando el módulo «Menú personalizable» está encendido para esta organización.
        </p>
        <p className="text-[12.5px] text-text-3">
          Quien administra la plataforma lo enciende desde el panel de Plataforma.
        </p>
      </div>
    );
  }
  return <NavigationSettingsClient />;
}
