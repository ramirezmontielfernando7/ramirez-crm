import { notFound } from "next/navigation";
import { OrganizationsClient } from "@/components/platform/organizations-client";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";

export const dynamic = "force-dynamic";

/**
 * 036 (PR 4) — Plataforma → Organizaciones: alta, estado, personas, módulos y
 * el consumo del mes (IA y almacenamiento aproximado) de cada organización.
 */
export default async function PlatformOrganizationsPage() {
  const admin = await currentPlatformAdmin();
  if (!admin) notFound();
  return <OrganizationsClient adminUserId={admin.userId} />;
}
