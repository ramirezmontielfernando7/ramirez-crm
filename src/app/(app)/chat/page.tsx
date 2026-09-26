import { Suspense } from "react";
import { TeamChatClient } from "@/components/team-chat/team-chat-client";

export const dynamic = "force-dynamic";

/** 025 — Chat de equipo (interno): todos los roles; lo que ve cada quien lo decide la API. */
export default function TeamChatPage() {
  return (
    <Suspense>
      <TeamChatClient />
    </Suspense>
  );
}
