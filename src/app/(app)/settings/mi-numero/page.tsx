import { notFound } from "next/navigation";
import { TeamNumbersClient } from "@/components/settings/team-numbers-client";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { orgHasMiNumero } from "@/server/modules";

export const dynamic = "force-dynamic";

/** Mi número (046) — Números del equipo (Propietario y Coordinador). Sin el complemento: 404. */
export default async function TeamNumbersPage() {
  const session = await requirePagePermission("mi_numero.manage");
  if (!(await orgHasMiNumero(session.organizationId))) notFound();
  return <TeamNumbersClient />;
}
