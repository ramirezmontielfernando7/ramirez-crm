import { and, eq, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { CampaignAudience, ExclusionReason } from "@/lib/campaigns";
import { contactFilterConditions, type SourceFilter } from "@/server/contact-filter";
import { notLabContact } from "@/server/analytics/shared";

/**
 * 021 — Público de una campaña.
 *
 * REGLA DURA: solo contactos con `wa_consent = 'opt_in'`. No es un aviso en la
 * pantalla ni un filtro que la UI "debería" mandar: está cableada AQUÍ, en la
 * única función que arma el público, y el filtro que llega del cliente no
 * tiene forma de pedir otra cosa. El despachador lo vuelve a comprobar
 * contacto por contacto justo antes de enviar (alguien pudo darse de baja a
 * mitad).
 *
 * Además: solo WhatsApp (las plantillas son de WhatsApp), sin archivados, sin
 * contactos del Laboratorio, y con un destino utilizable (teléfono o BSUID).
 *
 * Campañas v2 (PR 2): el público puede ser una base guardada de Audiencias
 * (`importId`): sus miembros, con las mismas reglas.
 */
export function audienceConditions(audience: CampaignAudience): SQL[] {
  return [
    eq(schema.contact.waConsent, "opt_in"),
    ...eligibleBase(),
    ...filterConditions(audience),
  ];
}

/** Lo que exige el envío además del consentimiento. */
function eligibleBase(): SQL[] {
  return [
    eq(schema.contact.channel, "whatsapp"),
    isNull(schema.contact.archivedAt),
    notLabContact(schema.contact.id),
    or(isNotNull(schema.contact.phone), isNotNull(schema.contact.waUserId))!,
  ];
}

/** El filtro elegido (etiquetas y fuente, o miembros de una base). */
function filterConditions(audience: CampaignAudience): SQL[] {
  if (audience.importId) {
    return [
      sql`exists (select 1 from ${schema.audienceMember} am
        where am.organization_id = ${schema.contact.organizationId}
          and am.contact_id = ${schema.contact.id}
          and am.import_id = ${audience.importId})`,
    ];
  }
  return contactFilterConditions({
    tagIds: audience.tagIds,
    source: audience.source as SourceFilter | undefined,
  });
}

export function emptyExclusions(): Record<ExclusionReason, number> {
  return { noConsent: 0, optOut: 0, invalid: 0, duplicate: 0, archived: 0, missingVariable: 0 };
}

/**
 * Cuántos recibirán y cuántos quedan fuera, por motivo. Una base guardada
 * suma además las filas que su archivo ya rechazó (inválidas y duplicadas).
 */
export async function audienceBreakdown(
  organizationId: string,
  audience: CampaignAudience
): Promise<{ eligible: number; excluded: Record<ExclusionReason, number> }> {
  // scoped-ok: campañas son de quien ve todo (permiso campaigns.manage).
  const rows = await getDb()
    .select({
      reason: sql<string>`case
        when ${schema.contact.archivedAt} is not null then 'archived'
        when ${schema.contact.phone} is null and ${schema.contact.waUserId} is null then 'invalid'
        when ${schema.contact.waConsent} = 'opt_out' then 'optOut'
        when ${schema.contact.waConsent} <> 'opt_in' then 'noConsent'
        else 'eligible' end`,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.channel, "whatsapp"),
        notLabContact(schema.contact.id),
        ...filterConditions(audience)
      )
    )
    .groupBy(sql`1`);
  const excluded = emptyExclusions();
  let eligible = 0;
  for (const r of rows) {
    if (r.reason === "eligible") eligible = Number(r.n);
    else excluded[r.reason as ExclusionReason] += Number(r.n);
  }
  if (audience.importId) {
    const imp = await getDb()
      .select({ counts: schema.audienceImport.counts })
      .from(schema.audienceImport)
      .where(scoped(schema.audienceImport.organizationId, organizationId, eq(schema.audienceImport.id, audience.importId)))
      .limit(1);
    const c = imp[0]?.counts ?? {};
    excluded.invalid += Number(c.invalid ?? 0);
    excluded.duplicate += Number(c.duplicate ?? 0);
  }
  return { eligible, excluded };
}

export type AudiencePreview = {
  /** A cuántos se les enviará. */
  eligible: number;
  /** Cumplen el filtro pero NO tienen opt_in (no recibirán nada). */
  withoutConsent: number;
  /** De esos, cuántos pidieron explícitamente no recibir. */
  optedOut: number;
};

/** 021 — Resumen corto (sigue sirviendo a `/api/campaigns/preview`). */
export async function previewAudience(organizationId: string, audience: CampaignAudience): Promise<AudiencePreview> {
  const b = await audienceBreakdown(organizationId, audience);
  return {
    eligible: b.eligible,
    withoutConsent: b.excluded.optOut + b.excluded.noConsent,
    optedOut: b.excluded.optOut,
  };
}

/**
 * Los contactos elegibles, para congelar la lista de destinatarios al lanzar,
 * con los valores de las columnas extra si el público es una base.
 */
export async function audienceContacts(
  organizationId: string,
  audience: CampaignAudience
): Promise<{ id: string; name: string; phone: string | null; fields: Record<string, string> }[]> {
  // scoped-ok: campañas son de quien ve todo (permiso campaigns.manage).
  const contacts = await getDb()
    .select({ id: schema.contact.id, name: schema.contact.name, phone: schema.contact.phone })
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, organizationId, ...audienceConditions(audience)));
  if (!audience.importId || contacts.length === 0) return contacts.map((c) => ({ ...c, fields: {} }));
  const members = await getDb()
    .select({ contactId: schema.audienceMember.contactId, fields: schema.audienceMember.fields })
    .from(schema.audienceMember)
    .where(
      scoped(
        schema.audienceMember.organizationId,
        organizationId,
        and(eq(schema.audienceMember.importId, audience.importId))
      )
    );
  const byContact = new Map(members.map((m) => [m.contactId, m.fields]));
  return contacts.map((c) => ({ ...c, fields: byContact.get(c.id) ?? {} }));
}
