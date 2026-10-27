import { notFound } from "next/navigation";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";
import { PanelClient } from "@/components/platform/panel-client";

export const dynamic = "force-dynamic";

/** 036 (PR 5) — «Mi panel»: el resumen de la plataforma de un vistazo. */
export default async function PlatformPanelPage() {
  if (!(await currentPlatformAdmin())) notFound();
  return <PanelClient />;
}
