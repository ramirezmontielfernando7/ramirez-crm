import { StageAssignments } from "@/components/lab/stage-assignments";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { requireModulePage } from "@/server/modules/page";

export const dynamic = "force-dynamic";

/** 031 (PR B) — Qué agente atiende cada etapa del pipeline. */
export default async function AsignacionPage() {
  await requirePagePermission("agent.manage");
  await requireModulePage("lab");
  return <StageAssignments />;
}
