import { notFound } from "next/navigation";
import { AuditLog } from "@/components/platform/audit-log";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";

export const dynamic = "force-dynamic";

/**
 * 036 (PR 4) — Plataforma → Mi panel. Por ahora, la bitácora de plataforma;
 * el resumen personal del dueño de la plataforma llega en el PR 5.
 */
export default async function PlatformPanelPage() {
  if (!(await currentPlatformAdmin())) notFound();
  return <AuditLog />;
}
