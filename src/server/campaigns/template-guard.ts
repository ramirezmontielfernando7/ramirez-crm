import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { logger } from "@/lib/log";
import { pauseCampaign } from "@/server/campaigns/lifecycle";
import { templateSendability } from "@/server/whatsapp/templates";

const log = logger("campaign");

/**
 * 038 (PR 6) — Meta pausó (por calidad), desactivó o retiró una plantilla:
 * las campañas que la usan y están enviando o esperan su hora se pausan YA,
 * con el motivo, sin esperar a que el siguiente envío falle. Una programada
 * para la madrugada amanece en pausa y avisada, no lanzada.
 *
 * La pausa es automática y SIN reanudación sola: Meta pausa una plantilla
 * porque la gente la está bloqueando o reportando, y volver a enviarla es
 * decisión de una persona (como la pausa por calidad roja del número).
 * Idempotente: una campaña ya en pausa no se toca. La llaman el webhook de
 * estado de plantillas y la sincronización con Meta (`whatsapp/templates.ts`).
 */
export async function pauseCampaignsWithBlockedTemplates(organizationId: string): Promise<number> {
  const rows = await getDb()
    .select({ campaignId: schema.campaign.id, template: schema.template })
    .from(schema.campaign)
    .innerJoin(
      schema.template,
      and(eq(schema.template.organizationId, schema.campaign.organizationId), eq(schema.template.id, schema.campaign.templateId))
    )
    .where(scoped(schema.campaign.organizationId, organizationId, inArray(schema.campaign.status, ["scheduled", "sending"])));
  let paused = 0;
  for (const r of rows) {
    const { sendable, reason } = templateSendability(r.template);
    if (sendable) continue;
    const ok = await pauseCampaign(organizationId, r.campaignId, {
      reason: blockedTemplateReason(r.template.name, reason),
      auto: true,
    });
    if (ok) {
      paused++;
      log.warn("campaña pausada: su plantilla ya no se puede enviar", { org: organizationId, campana: r.campaignId, motivo: reason });
    }
  }
  return paused;
}

export function blockedTemplateReason(name: string, reason: string | null): string {
  return `Se pausó: la plantilla «${name}» ya no se puede enviar${reason ? ` (${reason})` : ""}. Reanuda la campaña cuando Meta la reactive (su estado está en Plantillas).`;
}
