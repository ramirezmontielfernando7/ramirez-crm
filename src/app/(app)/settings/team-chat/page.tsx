import { TeamChatSettingsClient } from "@/components/settings/team-chat-settings";
import { requirePagePermission } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default async function TeamChatSettingsPage() {
  // 025: grupos = Propietario (o Coordinador con la delegación). La API decide igual.
  await requirePagePermission("team_chat.create_groups");
  return <TeamChatSettingsClient />;
}
