import { notFound } from "next/navigation";
import { DirectConnectionCard } from "@/components/settings/direct-connection-card";
import { DirectAdvancedCard } from "@/components/settings/direct-advanced-card";
import { can } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { orgHasConexionDirecta } from "@/server/modules";

export const dynamic = "force-dynamic";

/** Conexión directa (PR 2) — Vincular el dispositivo por QR. Sin el complemento: 404, cero rastro. */
export default async function DirectConnectionPage() {
  const session = await requirePagePermission("direct_connection.link");
  if (!(await orgHasConexionDirecta(session.organizationId))) notFound();
  return (
    <div className="space-y-6">
      <DirectConnectionCard />
      {can(session, "direct_connection.limits") && (
        <div className="max-w-3xl">
          <DirectAdvancedCard />
        </div>
      )}
    </div>
  );
}
