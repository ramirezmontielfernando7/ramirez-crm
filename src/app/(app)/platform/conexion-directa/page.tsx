import { notFound } from "next/navigation";
import { DirectServersClient } from "@/components/platform/direct-servers-client";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";

export const dynamic = "force-dynamic";

/** Conexión directa (PR 2) — Plataforma → servidores del dispositivo vinculado. */
export default async function PlatformDirectPage() {
  if (!(await currentPlatformAdmin())) notFound();
  return <DirectServersClient />;
}
