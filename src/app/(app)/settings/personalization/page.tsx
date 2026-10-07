import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppearanceClient } from "@/components/settings/appearance-client";
import { CHAT_STYLE_COOKIE, FONT_COOKIE, readPersonalAppearance } from "@/lib/appearance";
import { can } from "@/lib/auth/permissions";
import { getSessionOrNull } from "@/lib/auth/session";
import { getOrgAppearance } from "@/server/appearance";
import { getViewerBrandingContext } from "@/server/branding";

export const dynamic = "force-dynamic";

/**
 * Fase D — Apariencia. La puede abrir cualquier persona con sesión (cada
 * quien cambia su propia vista); cambiar la de toda la organización pide
 * `settings.manage`, y la ruta de la API lo valida en el servidor.
 */
export default async function AppearancePage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  const jar = await cookies();
  const { branding } = await getViewerBrandingContext();
  return (
    <AppearanceClient
      org={await getOrgAppearance(session.organizationId)}
      personal={readPersonalAppearance({
        font: jar.get(FONT_COOKIE)?.value,
        chatStyle: jar.get(CHAT_STYLE_COOKIE)?.value,
      })}
      canManageOrg={can(session, "settings.manage")}
      brandName={branding.name}
    />
  );
}
