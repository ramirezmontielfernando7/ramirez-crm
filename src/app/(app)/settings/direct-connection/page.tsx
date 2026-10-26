import { notFound } from "next/navigation";
import { DirectConnectionCard } from "@/components/settings/direct-connection-card";
import { DirectAdvancedCard } from "@/components/settings/direct-advanced-card";
import { can } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { DIRECT_TEXT } from "@/lib/direct-connection";
import { orgHasConexionDirecta } from "@/server/modules";

export const dynamic = "force-dynamic";

/**
 * Conexión directa — Ajustes en bloques numerados (Fer, 26 oct): 1 el
 * dispositivo vinculado; 2 el modo de los chats (con «Aplicar a todos»);
 * 3 los cambios automáticos; 4 los límites, plegados. Sin el complemento:
 * 404, cero rastro.
 */
export default async function DirectConnectionPage() {
  const session = await requirePagePermission("direct_connection.link");
  if (!(await orgHasConexionDirecta(session.organizationId))) notFound();
  return (
    <div className="max-w-3xl space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{DIRECT_TEXT.moduleName}</h2>
        <p className="text-sm text-muted-foreground">{DIRECT_TEXT.pageIntro}</p>
      </div>
      <DirectConnectionCard />
      {can(session, "direct_connection.limits") && (
        <DirectAdvancedCard canApplyAll={can(session, "direct_connection.mode") && session.access.seesAll} />
      )}
    </div>
  );
}
