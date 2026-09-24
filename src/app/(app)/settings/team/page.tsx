import { TeamClient } from "@/components/settings/team-client";
import { requirePagePermission } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  // 020: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  await requirePagePermission("users.read");
  return <TeamClient />;
}
