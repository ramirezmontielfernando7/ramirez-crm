import { withAuth } from "@/lib/api";
import { getAssistantStatus } from "@/server/assistant/status";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/**
 * 038 (PR 1) — ¿Puede responder el asistente interno? Estado, mensaje claro
 * y su crédito (recortado a la visibilidad de la organización: nunca dólares).
 * Solo el Propietario (`assistant.use`) y solo con el módulo encendido (404).
 */
export const GET = withAuth(
  async (session) => {
    const off = await moduleOff(session.organizationId, "asistente");
    if (off) return off;
    return Response.json({ status: await getAssistantStatus(session.organizationId, session.userId) });
  },
  { permission: "assistant.use" }
);
