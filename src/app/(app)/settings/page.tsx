import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { getSessionOrNull } from "@/lib/auth/session";
import { campaignsEnabled } from "@/server/campaigns/flag";

export const dynamic = "force-dynamic";

/** 020 — Cada rol aterriza en la primera pestaña que sí puede abrir. */
export default async function SettingsPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  if (can(session, "settings.manage")) redirect("/settings/whatsapp");
  // 030 (PR 4): con Campañas, Plantillas ya no es una pestaña de Ajustes.
  if (can(session, "templates.manage") && !(await campaignsEnabled(session.organizationId))) {
    redirect("/settings/templates");
  }
  if (can(session, "users.read")) redirect("/settings/team");
  redirect("/inbox");
}
