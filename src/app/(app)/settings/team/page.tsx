import { ChatVisibilityCard } from "@/components/settings/chat-visibility-card";
import { AdvisorNewChatsCard } from "@/components/settings/advisor-new-chats-card";
import { TeamClient } from "@/components/settings/team-client";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { can } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  // 020: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  const session = await requirePagePermission("users.read");
  return (
    <div className="space-y-6">
      <TeamClient />
      {/* Ronda 3: antes vivía en Canales y conexiones. */}
      {can(session, "settings.manage") && <ChatVisibilityCard />}
      {can(session, "settings.manage") && <AdvisorNewChatsCard />}
    </div>
  );
}
