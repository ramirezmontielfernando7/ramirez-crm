import { notFound } from "next/navigation";
import { DocumentsClient } from "@/components/lab/documents-client";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { kbDocsEnabled } from "@/server/kb-docs/flag";
import { requireModulePage } from "@/server/modules/page";

export const dynamic = "force-dynamic";

/** 035 — Documentos del negocio que el agente consulta antes de responder. */
export default async function DocumentosPage() {
  await requirePagePermission("agent.manage");
  await requireModulePage("lab");
  if (!kbDocsEnabled()) notFound();
  return <DocumentsClient />;
}
