import { notFound } from "next/navigation";
import { AgendaClient } from "@/components/settings/agenda-client";
import { agendaEnabled } from "@/server/agenda/flag";
import { requirePagePermission } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default async function AgendaSettingsPage() {
  // 020: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  const session = await requirePagePermission("settings.manage");
  // Sin el módulo esta pantalla no existe para esta organización.
  if (!(await agendaEnabled(session.organizationId))) notFound();
  return <AgendaClient />;
}
