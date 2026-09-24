import { notFound } from "next/navigation";
import { MessengerClient } from "@/components/settings/messenger-client";
import { isChannelEnabled } from "@/server/channels/enabled";
import { requirePagePermission } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default async function MessengerSettingsPage() {
  // 020: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  await requirePagePermission("settings.manage");
  // Sin el canal encendido esta pantalla no existe en esta instancia (ADR-001).
  if (!isChannelEnabled("messenger")) notFound();
  return <MessengerClient />;
}
