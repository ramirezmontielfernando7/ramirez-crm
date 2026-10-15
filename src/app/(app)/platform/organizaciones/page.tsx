import { notFound } from "next/navigation";
import { OrganizationsClient } from "@/components/platform/organizations-client";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";

export const dynamic = "force-dynamic";

/**
 * 036 (PR 4) / 040 — Plataforma → Organizaciones y Planes: la tabla con
 * filtros (estado, plan) y el alta. Cada fila abre su ficha en pestañas.
 */
export default async function PlatformOrganizationsPage() {
  if (!(await currentPlatformAdmin())) notFound();
  return <OrganizationsClient />;
}
