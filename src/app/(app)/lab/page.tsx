import { LabClient } from "@/components/lab/lab-client";
import { requirePagePermission } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  // 020: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  await requirePagePermission("agent.manage");
  return <LabClient />;
}
