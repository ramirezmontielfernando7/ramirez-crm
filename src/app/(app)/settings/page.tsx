import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { getSessionOrNull } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** 020 — Cada rol aterriza en la primera pestaña que sí puede abrir. */
export default async function SettingsPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  if (can(session, "settings.manage")) redirect("/settings/whatsapp");
  if (can(session, "templates.manage")) redirect("/settings/templates");
  if (can(session, "users.read")) redirect("/settings/team");
  redirect("/inbox");
}
