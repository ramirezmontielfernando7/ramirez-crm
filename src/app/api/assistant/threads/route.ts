import { withAuth } from "@/lib/api";
import { ensureGeneralThread, listThreads } from "@/server/assistant/threads";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/** 038 — El Chat general y los hilos del asistente de quien pide (solo los suyos; archivados incluidos). */
export const GET = withAuth(
  async (session) => {
    const off = await moduleOff(session.organizationId, "asistente");
    if (off) return off;
    const general = await ensureGeneralThread(session.organizationId, session.userId);
    return Response.json({ general, threads: await listThreads(session.organizationId, session.userId) });
  },
  { permission: "assistant.use" }
);
