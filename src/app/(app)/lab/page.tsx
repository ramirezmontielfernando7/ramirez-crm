import { AgentsList } from "@/components/lab/agents-list";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { requireModulePage } from "@/server/modules/page";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  await requirePagePermission("agent.manage");
  await requireModulePage("agent");
  return <AgentsList />;
}
