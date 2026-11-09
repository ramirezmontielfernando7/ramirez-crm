import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { getSessionOrNull } from "@/lib/auth/session";
import { campaignsEnabled } from "@/server/campaigns/flag";
import { hasMyNumber } from "@/server/mi-numero/numbers";
import { orgHasMiNumero } from "@/server/modules";
import { DesktopRedirect } from "@/components/settings/desktop-redirect";

export const dynamic = "force-dynamic";

/** 020 — Cada rol aterriza en la primera pestaña que sí puede abrir. */
export default async function SettingsPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  return <DesktopRedirect to={await firstTab(session)} />;
}

async function firstTab(session: NonNullable<Awaited<ReturnType<typeof getSessionOrNull>>>): Promise<string> {
  if (can(session, "settings.manage")) return "/settings/whatsapp";
  // 030 (PR 4): con Campañas, Plantillas ya no es una pestaña de Ajustes.
  if (can(session, "templates.manage") && !(await campaignsEnabled(session.organizationId))) {
    return "/settings/templates";
  }
  if (can(session, "users.read")) return "/settings/team";
  // 046: quien solo tiene un «Mi número» autorizado aterriza en él.
  if ((await orgHasMiNumero(session.organizationId)) && (await hasMyNumber(session.organizationId, session.userId))) {
    return "/settings/my-number";
  }
  return "/inbox";
}
