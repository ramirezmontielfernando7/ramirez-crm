import { KnowledgeClient } from "@/components/knowledge/knowledge-client";

export const dynamic = "force-dynamic";

/** 024 — Conocimientos: todos los roles lo ven; editar lo decide la matriz. */
export default function KnowledgePage() {
  return <KnowledgeClient />;
}
