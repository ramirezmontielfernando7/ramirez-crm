import { notFound } from "next/navigation";
import { NavigationSettingsClient } from "@/components/settings/navigation-settings";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { orgHasCustomNav } from "@/server/modules";

export const dynamic = "force-dynamic";

/**
 * 030 (PR 4) — Ajustes → Navegación: el menú de cada rol. Solo el
 * Propietario y solo si la plataforma encendió `custom_nav` para esta
 * organización (si no, la pantalla no existe). La API valida igual.
 */
export default async function NavigationSettingsPage() {
  const session = await requirePagePermission("settings.manage");
  if (!(await orgHasCustomNav(session.organizationId))) notFound();
  return <NavigationSettingsClient />;
}
