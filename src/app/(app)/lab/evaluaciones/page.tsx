import { LabClient } from "@/components/lab/lab-client";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { requireModulePage } from "@/server/modules/page";

export const dynamic = "force-dynamic";

export default async function EvaluacionesPage() {
  await requirePagePermission("agent.manage");
  await requireModulePage("lab");
  return <LabClient />;
}
