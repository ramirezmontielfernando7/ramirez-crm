import { AgentEditor } from "@/components/lab/agent-editor";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { requireModulePage } from "@/server/modules/page";

export const dynamic = "force-dynamic";

export default async function AgentEditorPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("agent.manage");
  await requireModulePage("lab");
  const { id } = await params;
  return <AgentEditor id={id} />;
}
