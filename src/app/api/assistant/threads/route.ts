import { withAuth } from "@/lib/api";
import { listThreads } from "@/server/assistant/threads";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/** 038 (PR 2) — Las conversaciones del asistente de quien pide (solo las suyas). */
export const GET = withAuth(
  async (session) => {
    const off = await moduleOff(session.organizationId, "asistente");
    if (off) return off;
    return Response.json({ threads: await listThreads(session.organizationId, session.userId) });
  },
  { permission: "assistant.use" }
);
