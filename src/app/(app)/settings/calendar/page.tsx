import { notFound } from "next/navigation";
import { AgendaClient } from "@/components/settings/agenda-client";
import { agendaEnabled } from "@/server/agenda/flag";
import { requirePagePermission } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default async function AgendaSettingsPage() {
  // 020: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  await requirePagePermission("settings.manage");
  // Sin la bandera esta pantalla no existe en esta instancia.
  if (!agendaEnabled()) notFound();
  return <AgendaClient />;
}
