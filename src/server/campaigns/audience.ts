import { and, eq, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { CampaignAudience } from "@/lib/campaigns";
import { contactFilterConditions, type SourceFilter } from "@/server/contact-filter";
import { notLabContact } from "@/server/analytics/shared";

/**
 * 021 — Público de una campaña.
 *
 * REGLA DURA: solo contactos con `wa_consent = 'opt_in'`. No es un aviso en la
 * pantalla ni un filtro que la UI "debería" mandar: está cableada AQUÍ, en la
 * única función que arma el público, y el filtro que llega del cliente no
 * tiene forma de pedir otra cosa. El ejecutor lo vuelve a comprobar contacto
 * por contacto justo antes de enviar (alguien pudo darse de baja a mitad).
 *
 * Además: solo WhatsApp (las plantillas son de WhatsApp), sin archivados, sin
 * contactos del Laboratorio, y con un destino utilizable (teléfono o BSUID).
 */
export function audienceConditions(audience: CampaignAudience): SQL[] {
  return [
    eq(schema.contact.waConsent, "opt_in"),
    ...baseConditions(audience),
  ];
}

/** Todo menos el consentimiento: para decir cuántos quedaron fuera por él. */
function baseConditions(audience: CampaignAudience): SQL[] {
  return [
    eq(schema.contact.channel, "whatsapp"),
    isNull(schema.contact.archivedAt),
    notLabContact(schema.contact.id),
    or(isNotNull(schema.contact.phone), isNotNull(schema.contact.waUserId))!,
    ...contactFilterConditions({
      tagIds: audience.tagIds,
      source: audience.source as SourceFilter | undefined,
    }),
  ];
}

export type AudiencePreview = {
  /** A cuántos se les enviará. */
  eligible: number;
  /** Cumplen el filtro pero NO tienen opt_in (no recibirán nada). */
  withoutConsent: number;
  /** De esos, cuántos pidieron explícitamente no recibir. */
  optedOut: number;
};

export async function previewAudience(
  organizationId: string,
  audience: CampaignAudience
): Promise<AudiencePreview> {
  // scoped-ok: campañas son de quien ve todo (permiso campaigns.manage).
  const rows = await getDb()
    .select({
      consent: schema.contact.waConsent,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, organizationId, and(...baseConditions(audience))))
    .groupBy(schema.contact.waConsent);
  const by = new Map(rows.map((r) => [r.consent, Number(r.n)]));
  const eligible = by.get("opt_in") ?? 0;
  const optedOut = by.get("opt_out") ?? 0;
  return { eligible, withoutConsent: optedOut + (by.get("desconocido") ?? 0), optedOut };
}

/** Los contactos elegibles, para congelar la lista de destinatarios al lanzar. */
export async function audienceContacts(organizationId: string, audience: CampaignAudience) {
  // scoped-ok: campañas son de quien ve todo (permiso campaigns.manage).
  return getDb()
    .select({ id: schema.contact.id, name: schema.contact.name, phone: schema.contact.phone })
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, organizationId, ...audienceConditions(audience)));
}
