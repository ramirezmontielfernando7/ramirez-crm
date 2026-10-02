import { redirect } from "next/navigation";
import { TemplatesClient } from "@/components/settings/templates-client";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { campaignsEnabled } from "@/server/campaigns/flag";

export const dynamic = "force-dynamic";

export default async function TemplatesSettingsPage() {
  // 020: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  const session = await requirePagePermission("templates.manage");
  // 030 (PR 4): con Campañas, las plantillas viven en Campañas → Plantillas;
  // esta dirección redirige (los marcadores siguen sirviendo). Sin Campañas,
  // se quedan aquí: la Bandeja las sigue usando.
  if (await campaignsEnabled(session.organizationId)) redirect("/campaigns/templates");
  return <TemplatesClient />;
}
