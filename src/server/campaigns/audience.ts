import { and, eq, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  isMarketingCategory,
  marketingCutoff,
  type CampaignAudience,
  type CampaignSettingsDto,
  type ExclusionReason,
} from "@/lib/campaigns";
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
 *
 * 038 (PR 6): con una plantilla de MARKETING (`marketing` no nulo) quedan
 * fuera además quien dejó de recibir promociones desde WhatsApp (Meta
 * respondió 131050) y quien recibió otra campaña de marketing hace menos de
 * `marketing_min_days`. Utilidad y autenticación no cambian.
 */
export function audienceConditions(audience: CampaignAudience, marketing: MarketingRules | null = null): SQL[] {
  return [
    eq(schema.contact.waConsent, "opt_in"),
    ...eligibleBase(),
    ...marketingConditions(marketing),
    ...filterConditions(audience),
  ];
}

/**
 * 038 (PR 6) — Las reglas de marketing de una campaña. null = la plantilla
 * no es de marketing (no aplica nada). `cutoff` null = tope de frecuencia
 * apagado (0 días); la baja 131050 aplica igual. `campaignId` = la campaña
 * que se revisa, que no se cuenta a sí misma.
 */
export type MarketingRules = { cutoff: Date | null; campaignId?: string | null };

export function marketingRulesFor(
  category: string | null | undefined,
  settings: Pick<CampaignSettingsDto, "marketingMinDays">,
  opts: { campaignId?: string | null; now?: Date } = {}
): MarketingRules | null {
  if (!isMarketingCategory(category)) return null;
  return { cutoff: marketingCutoff(settings.marketingMinDays, opts.now), campaignId: opts.campaignId ?? null };
}

function marketingConditions(marketing: MarketingRules | null): SQL[] {
  if (!marketing) return [];
  const out: SQL[] = [isNull(schema.contact.waMarketingOptOutAt)];
  if (marketing.cutoff) out.push(sql`not ${recentMarketingExists(marketing)}`);
  return out;
}

/**
 * ¿Este contacto recibió otra campaña de MARKETING desde `cutoff`? Cuenta lo
 * que salió (`sent`) y Meta no rechazó después (un `failed` del webhook no
 * llegó a nadie). La categoría es la ACTUAL de la plantilla de esa campaña.
 */
function recentMarketingExists(marketing: MarketingRules): SQL {
  const cutoff = (marketing.cutoff ?? new Date(0)).toISOString();
  const self = marketing.campaignId ? sql`and c.id <> ${marketing.campaignId}` : sql``;
  return sql`exists (select 1 from ${schema.campaignRecipient} cr
    join ${schema.campaign} c on c.organization_id = cr.organization_id and c.id = cr.campaign_id
    join ${schema.template} t on t.organization_id = c.organization_id and t.id = c.template_id
    where cr.organization_id = ${schema.contact.organizationId}
      and cr.contact_id = ${schema.contact.id}
      and cr.status = 'sent'
      and cr.sent_at >= ${cutoff}::timestamp
      and lower(t.category) = 'marketing'
      ${self}
      and not exists (select 1 from ${schema.message} m
        where m.organization_id = cr.organization_id and m.id = cr.message_id and m.status = 'failed'))`;
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
  return {
    noConsent: 0,
    optOut: 0,
    invalid: 0,
    duplicate: 0,
    archived: 0,
    missingVariable: 0,
    marketingOptOut: 0,
    recentMarketing: 0,
  };
}

/**
 * Cuántos recibirán y cuántos quedan fuera, por motivo. Una base guardada
 * suma además las filas que su archivo ya rechazó (inválidas y duplicadas).
 */
export async function audienceBreakdown(
  organizationId: string,
  audience: CampaignAudience,
  marketing: MarketingRules | null = null
): Promise<{ eligible: number; excluded: Record<ExclusionReason, number> }> {
  const marketingCases = marketing
    ? sql`when ${schema.contact.waMarketingOptOutAt} is not null then 'marketingOptOut'
        ${marketing.cutoff ? sql`when ${recentMarketingExists(marketing)} then 'recentMarketing'` : sql``}`
    : sql``;
  // scoped-ok: campañas son de quien ve todo (permiso campaigns.manage).
  const rows = await getDb()
    .select({
      reason: sql<string>`case
        when ${schema.contact.archivedAt} is not null then 'archived'
        when ${schema.contact.phone} is null and ${schema.contact.waUserId} is null then 'invalid'
        when ${schema.contact.waConsent} = 'opt_out' then 'optOut'
        when ${schema.contact.waConsent} <> 'opt_in' then 'noConsent'
        ${marketingCases}
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
  // Sin plantilla todavía: solo consentimiento (las reglas de marketing las
  // aplica el paso con plantilla, `previewCampaign`).
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
  audience: CampaignAudience,
  marketing: MarketingRules | null = null
): Promise<{ id: string; name: string; phone: string | null; fields: Record<string, string> }[]> {
  // scoped-ok: campañas son de quien ve todo (permiso campaigns.manage).
  const contacts = await getDb()
    .select({ id: schema.contact.id, name: schema.contact.name, phone: schema.contact.phone })
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, organizationId, ...audienceConditions(audience, marketing)));
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

/**
 * 038 (PR 6) — Re-verificación de ÚLTIMA HORA para un destinatario de una
 * campaña de marketing (el público se congeló al lanzar; desde entonces Meta
 * pudo avisar 131050 u otra campaña de marketing pudo llegarle antes). Devuelve
 * el motivo para omitirlo, o null si se le puede enviar.
 */
export async function marketingSkipReason(
  organizationId: string,
  input: {
    campaignId: string;
    templateId: string;
    contact: { id: string; waMarketingOptOutAt: Date | null };
    settings: Pick<CampaignSettingsDto, "marketingMinDays">;
  }
): Promise<string | null> {
  const db = getDb();
  const t = await db
    .select({ category: schema.template.category })
    .from(schema.template)
    .where(scoped(schema.template.organizationId, organizationId, eq(schema.template.id, input.templateId)))
    .limit(1);
  const rules = marketingRulesFor(t[0]?.category, input.settings, { campaignId: input.campaignId });
  if (!rules) return null;
  if (input.contact.waMarketingOptOutAt) {
    return "Dejó de recibir promociones de este negocio en WhatsApp (131050): no se le envió";
  }
  if (!rules.cutoff) return null;
  const recent = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.id, input.contact.id),
        recentMarketingExists(rules)
      )
    )
    .limit(1);
  return recent.length > 0
    ? `Recibió otra campaña de marketing hace menos de ${input.settings.marketingMinDays} días: no se le envió`
    : null;
}
