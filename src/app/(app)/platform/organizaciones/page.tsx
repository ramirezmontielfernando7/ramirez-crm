import { notFound } from "next/navigation";
import { OrganizationsClient } from "@/components/platform/organizations-client";
import { PlanCatalogCard } from "@/components/platform/plan-catalog-client";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";

export const dynamic = "force-dynamic";

/**
 * 036 (PR 4) / 040 — Plataforma → Organizaciones y Planes: la tabla con
 * filtros (estado, plan) y el alta. Cada fila abre su ficha en pestañas.
 * Debajo, «Planes y precios»: el catálogo que ve el cliente en «Mejora tu plan».
 */
export default async function PlatformOrganizationsPage() {
  if (!(await currentPlatformAdmin())) notFound();
  return (
    <div className="space-y-6">
      <OrganizationsClient />
      <PlanCatalogCard />
    </div>
  );
}
