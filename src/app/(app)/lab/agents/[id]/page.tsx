import { AgentEditor } from "@/components/lab/agent-editor";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { kbDocsEnabled } from "@/server/kb-docs/flag";
import { orgHasModule } from "@/server/modules";
import { requireModulePage } from "@/server/modules/page";

export const dynamic = "force-dynamic";

export default async function AgentEditorPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("agent.manage");
  const session = await requireModulePage("agent");
  const { id } = await params;
  // Los documentos de la IA son del Laboratorio (Pro).
  const documents = kbDocsEnabled() && (await orgHasModule(session.organizationId, "lab"));
  return <AgentEditor id={id} documents={documents} />;
}
