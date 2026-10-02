import { KnowledgeClient } from "@/components/knowledge/knowledge-client";
import { requireModulePage } from "@/server/modules/page";

export const dynamic = "force-dynamic";

/** 024 — Conocimientos: todos los roles lo ven; editar lo decide la matriz. */
export default async function KnowledgePage() {
  // 030 (PR 4): sin el módulo, la pantalla no existe para esta organización.
  await requireModulePage("knowledge");
  return <KnowledgeClient />;
}
