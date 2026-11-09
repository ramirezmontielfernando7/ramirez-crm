import { notFound } from "next/navigation";
import { OrganizationsAndPlans } from "@/components/platform/organizations-and-plans";
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
    <div className="p-4 sm:p-6">
      <OrganizationsAndPlans />
    </div>
  );
}
