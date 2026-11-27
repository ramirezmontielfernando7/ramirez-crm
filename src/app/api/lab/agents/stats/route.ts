import { withAuth } from "@/lib/api";
import { agentStats } from "@/server/agents/stats";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/** Ronda 3 — Chats de los últimos 7 días por agente y resueltos sin persona (solo lectura). */
export const GET = withAuth(async (session) => {
  const off = await moduleOff(session.organizationId, "agent");
  if (off) return off;
  return Response.json(await agentStats(session.access));
}, { permission: "agent.manage" });
