/**
 * 021 — Si esta instancia tiene Campañas (envío masivo) o no.
 *
 * Mismo patrón que `AGENDA` y `ATRIBUCION` (ADR-001): el código viaja en
 * main y la migración se aplica siempre. Desde la Fase 3 (PR 3) lo que decide
 * si la superficie EXISTE es el módulo de la organización. Apagado, la
 * pantalla y las rutas responden 404.
 *
 * Etiquetas, consentimiento e importar/exportar NO dependen de esta bandera:
 * son útiles por sí solos y no tocan la API de Meta.
 */

import { orgCampaignSendRate, orgHasCampaigns } from "@/server/modules";

export { parseCampaignsFlag } from "@/server/modules/defaults";

/**
 * Fase 3, PR 3 — Por ORGANIZACIÓN (`organization_module`); la variable
 * `CAMPAIGNS` queda como valor por defecto (src/server/modules/).
 */
export async function campaignsEnabled(organizationId: string): Promise<boolean> {
  return orgHasCampaigns(organizationId);
}

/** 404 y no 403: apagada, la superficie no existe en esta instancia. */
export function campaignsDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}

/**
 * Mensajes por segundo del envío masivo de esta organización (por defecto
 * `CAMPAIGN_SEND_RATE`, o 10; tope 80, lo que Meta admite por número).
 */
export async function campaignSendRate(organizationId: string): Promise<number> {
  return orgCampaignSendRate(organizationId);
}
