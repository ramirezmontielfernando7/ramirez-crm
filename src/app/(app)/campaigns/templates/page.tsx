import { notFound } from "next/navigation";
import { TemplatesClient } from "@/components/settings/templates-client";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { campaignsEnabled } from "@/server/campaigns/flag";

export const dynamic = "force-dynamic";

/**
 * 030 (PR 4) — Pestaña Plantillas de Campañas: crear, importar y ver las
 * plantillas de Meta, junto a Campañas, Audiencias y Métricas. Sin el módulo
 * Campañas no existe (404) y las plantillas siguen en Ajustes → Plantillas,
 * porque la Bandeja también las usa (ventana de 24 h cerrada). Con `shell`,
 * el cliente pinta el cascarón de Marketing y pone sus botones en el encabezado.
 */
export default async function CampaignTemplatesPage() {
  const session = await requirePagePermission("templates.manage");
  if (!(await campaignsEnabled(session.organizationId))) notFound();
  return <TemplatesClient shell />;
}
