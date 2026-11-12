import { notFound } from "next/navigation";
import { ControlsClient } from "@/components/platform/controls-client";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";

export const dynamic = "force-dynamic";

/** 048 — Plataforma → Controles (interruptores de emergencia y aviso a todos). */
export default async function PlatformControlsPage() {
  if (!(await currentPlatformAdmin())) notFound();
  return <ControlsClient />;
}
