import { WhatsappWizard } from "@/components/settings/whatsapp-wizard";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { can } from "@/lib/auth/permissions";
import { campaignsEnabled } from "@/server/campaigns/flag";
import { orgHasConexionDirecta } from "@/server/modules";

export const dynamic = "force-dynamic";

/**
 * Ajustes → Canales y conexiones (ronda 3): el número oficial y el teléfono
 * vinculado con su estado, «¿Por dónde salen los chats nuevos?», y los
 * renglones Plantillas y Opciones avanzadas (reconectar, webhook y PIN,
 * plegados salvo que algo pida atención). Las bajas viven en «Bajas
 * automáticas» y «Chats nuevos de los asesores» en Equipo y permisos.
 */
export default async function WhatsappSettingsPage() {
  // 020: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  const session = await requirePagePermission("settings.manage");
  const [hasDirect, campaigns] = await Promise.all([
    orgHasConexionDirecta(session.organizationId),
    campaignsEnabled(session.organizationId),
  ]);
  const direct = hasDirect && can(session, "direct_connection.link") ? { canMode: can(session, "direct_connection.limits") } : null;
  const templatesHref = campaigns ? "/campaigns/templates" : can(session, "templates.manage") ? "/settings/templates" : null;
  return <WhatsappWizard direct={direct} templatesHref={templatesHref} />;
}
