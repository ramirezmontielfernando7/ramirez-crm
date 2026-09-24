import { notFound } from "next/navigation";
import { AdsClient } from "@/components/settings/ads-client";
import { atribucionEnabled } from "@/server/attribution/flag";
import { requirePagePermission } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default async function AdsSettingsPage() {
  // 020: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  await requirePagePermission("settings.manage");
  // Sin la bandera esta pantalla no existe en esta instancia.
  if (!atribucionEnabled()) notFound();
  return <AdsClient />;
}
