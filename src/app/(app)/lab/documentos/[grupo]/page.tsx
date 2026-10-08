import { notFound } from "next/navigation";
import { DocumentsClient } from "@/components/lab/documents-client";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { kbDocsEnabled } from "@/server/kb-docs/flag";
import { requireModulePage } from "@/server/modules/page";

export const dynamic = "force-dynamic";

/** 037 — Un grupo de documentos (General vive en /lab/documentos). */
export default async function DocumentosGrupoPage({ params }: { params: Promise<{ grupo: string }> }) {
  await requirePagePermission("agent.manage");
  await requireModulePage("lab");
  if (!kbDocsEnabled()) notFound();
  const { grupo } = await params;
  return <DocumentsClient groupKey={grupo} />;
}
