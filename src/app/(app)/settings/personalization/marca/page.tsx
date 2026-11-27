import { BrandingClient } from "@/components/settings/branding-client";
import { FaviconCard } from "@/components/settings/favicon-card";
import { getBranding } from "@/server/branding";
import { getSessionOrNull } from "@/lib/auth/session";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { SettingsHeader } from "@/components/settings/settings-header";

export const dynamic = "force-dynamic";

export default async function BrandingSettingsPage() {
  // 020: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  await requirePagePermission("settings.manage");
  // La marca se lee en el servidor para que la tarjeta del icono ya pinte la
  // vista previa correcta en el primer render, sin un parpadeo del generado al
  // subido mientras un fetch del cliente va y vuelve.
  const session = await getSessionOrNull();
  const branding = await getBranding(session?.organizationId);

  return (
    <div className="space-y-6">
      <SettingsHeader mobileTitle title="Marca" description="El nombre, los colores y el ícono con los que tu equipo ve Dashfort." />
      {/* El logo viaja como prop: al subirlo o quitarlo, FaviconCard refresca
          la página y la vista previa de la marca lo sigue sin recargar. */}
      <BrandingClient favicon={branding.favicon} />
      <FaviconCard branding={branding} />
    </div>
  );
}
