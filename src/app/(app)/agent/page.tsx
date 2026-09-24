import { AgentClient } from "@/components/agent/agent-client";
import { requirePagePermission } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  // 020: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  await requirePagePermission("agent.manage");
  return <AgentClient />;
}
