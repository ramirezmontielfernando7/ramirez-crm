import { notFound } from "next/navigation";
import { CampaignsTabs } from "@/components/campaigns/campaigns-tabs";
import { TemplatesClient } from "@/components/settings/templates-client";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { campaignsEnabled } from "@/server/campaigns/flag";

export const dynamic = "force-dynamic";

/**
 * 030 (PR 4) — Pestaña Plantillas de Campañas: crear, sincronizar y ver las
 * plantillas de Meta, junto a Campañas, Audiencias y Métricas. Sin el módulo
 * Campañas no existe (404) y las plantillas siguen en Ajustes → Plantillas,
 * porque la Bandeja también las usa (ventana de 24 h cerrada).
 */
export default async function CampaignTemplatesPage() {
  const session = await requirePagePermission("templates.manage");
  if (!(await campaignsEnabled(session.organizationId))) notFound();
  return (
    <div className="flex h-full flex-col">
      <CampaignsTabs />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <TemplatesClient />
      </div>
    </div>
  );
}
