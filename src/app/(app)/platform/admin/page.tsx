import { notFound } from "next/navigation";
import { AdminsClient } from "@/components/platform/admins-client";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";

export const dynamic = "force-dynamic";

/** 040 — Plataforma → Administradores y auditoría. */
export default async function PlatformAdminPage() {
  if (!(await currentPlatformAdmin())) notFound();
  return <AdminsClient />;
}
