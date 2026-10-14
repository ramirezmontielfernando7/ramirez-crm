import { Suspense } from "react";
import { TeamChatClient } from "@/components/team-chat/team-chat-client";
import { requireModulePage } from "@/server/modules/page";

export const dynamic = "force-dynamic";

/** 025 — Chat de equipo (interno): todos los roles; lo que ve cada quien lo decide la API. */
export default async function TeamChatPage() {
  // 030 (PR 4): sin el módulo, la pantalla no existe para esta organización.
  await requireModulePage("team_chat");
  return (
    <Suspense>
      <TeamChatClient />
    </Suspense>
  );
}
