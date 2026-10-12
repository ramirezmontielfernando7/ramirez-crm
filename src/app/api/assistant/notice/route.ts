import { withAuth } from "@/lib/api";
import { acceptAssistantNotice } from "@/server/assistant/status";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/**
 * 038 (PR 1) — La persona acepta el aviso de consumo del asistente (se le
 * pide una vez, antes de usarlo). Solo el Propietario y con el módulo.
 */
export const POST = withAuth(
  async (session) => {
    const off = await moduleOff(session.organizationId, "asistente");
    if (off) return off;
    return Response.json({ noticeAcceptedAt: await acceptAssistantNotice(session.organizationId, session.userId) });
  },
  { permission: "assistant.use" }
);
