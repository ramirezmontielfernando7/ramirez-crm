import { LabClient } from "@/components/lab/lab-client";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { requireModulePage } from "@/server/modules/page";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  // 020: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  await requirePagePermission("agent.manage");
  // 030 (PR 4): sin el módulo, la pantalla no existe para esta organización.
  await requireModulePage("lab");
  return <LabClient />;
}
