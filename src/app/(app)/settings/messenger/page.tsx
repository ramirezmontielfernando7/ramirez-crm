import { notFound } from "next/navigation";
import { MessengerClient } from "@/components/settings/messenger-client";
import { isChannelEnabled } from "@/server/channels/enabled";
import { requirePagePermission } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default async function MessengerSettingsPage() {
  // 020: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  const session = await requirePagePermission("settings.manage");
  // Sin el canal encendido esta pantalla no existe para esta organización (ADR-001).
  if (!(await isChannelEnabled(session.organizationId, "messenger"))) notFound();
  return <MessengerClient />;
}
