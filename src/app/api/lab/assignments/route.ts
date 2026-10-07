import { withAuth } from "@/lib/api";
import { listStageAssignments } from "@/server/agents/assignments";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/**
 * 031 (PR B) — El mapa de etapas: cada etapa del pipeline con su agente (o
 * el general) y los agentes que se pueden asignar (publicados, no generales).
 */
export const GET = withAuth(async (session) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? (await moduleOff(session.organizationId, "agent"));
  if (off) return off;
  return Response.json(await listStageAssignments(session.organizationId));
}, { permission: "agent.manage" });
