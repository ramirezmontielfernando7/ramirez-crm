import { notFound } from "next/navigation";
import { AdsClient } from "@/components/settings/ads-client";
import { atribucionEnabled } from "@/server/attribution/flag";
import { requirePagePermission } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default async function AdsSettingsPage() {
  // 020: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  const session = await requirePagePermission("settings.manage");
  // Sin el módulo esta pantalla no existe para esta organización.
  if (!(await atribucionEnabled(session.organizationId))) notFound();
  return <AdsClient />;
}
