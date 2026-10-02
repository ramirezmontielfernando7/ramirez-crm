import { inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { bucketsDelPeriodo } from "@/lib/analytics";
import {
  campaignEstimatedCost,
  emptyFunnel,
  reconcileCost,
  type CampaignMetricsDto,
  type CampaignMetricsRow,
  type FailureReason,
  type FunnelCounts,
  type MetaSyncInfo,
} from "@/lib/campaign-metrics";
import { describeSendError } from "@/lib/meta/send-errors";
import { businessTimezone, resolvePeriod } from "@/server/analytics/period";
import { getOrgCredentials } from "@/server/credentials";
import { getCampaignSettings } from "@/server/campaigns/settings";

/**
 * Campañas v2 (PR 3) — Pestaña Métricas. Todo sale de la base propia
 * (mensajes, destinatarios y las analíticas que la sincronización diaria
 * copió de Meta): ninguna consulta a Meta en vivo.
 *
 * Un destinatario cuenta en el periodo por la hora en que se le envió (o se
 * intentó). Las definiciones de cada número están en `lib/campaign-metrics.ts`.
 *
 * Las consultas son SQL crudo con `organization_id` explícito en cada tabla
 * (además del RLS de la conexión): la regla de "respondieron" (entrante en la
 * misma conversación dentro de la ventana) no cabe bien en el constructor.
 * Solo la ven Propietario y Coordinador (`campaigns.manage`), que ven todo el
 * negocio.
 */

type FunnelRow = {
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  opt_outs: number;
};

const toFunnel = (r: Partial<FunnelRow> | undefined): FunnelCounts => ({
  sent: Number(r?.sent ?? 0),
  delivered: Number(r?.delivered ?? 0),
  read: Number(r?.read ?? 0),
  replied: Number(r?.replied ?? 0),
  failed: Number(r?.failed ?? 0),
  optOuts: Number(r?.opt_outs ?? 0),
});

export async function getCampaignMetrics(
  organizationId: string,
  input: { from?: string | null; to?: string | null; phoneNumberId?: string | null }
): Promise<CampaignMetricsDto> {
  const timezone = await businessTimezone(organizationId);
  const period = resolvePeriod({ from: input.from, to: input.to, timezone });
  const settings = await getCampaignSettings(organizationId);
  const phone = input.phoneNumberId?.trim() || null;
  const byMonth = period.dto.granularity === "month";
  const db = getDb();

  // Los hechos por destinatario, una sola vez: el resto son agregados.
  const facts = sql`
    with facts as (
      select
        cr.campaign_id,
        coalesce(cr.sent_at, m.sent_at, m.failed_at, m.created_at, cr.created_at) as at,
        (cr.status = 'sent') as is_sent,
        (cr.status = 'sent' and (m.delivered_at is not null or m.status in ('delivered', 'read'))) as is_delivered,
        (cr.status = 'sent' and (m.read_at is not null or m.status = 'read')) as is_read,
        (cr.status = 'failed' or m.status = 'failed') as is_failed,
        (cr.status = 'sent' and m.id is not null and exists (
          select 1 from message r
          where r.organization_id = m.organization_id
            and r.conversation_id = m.conversation_id
            and r.direction = 'in'
            and r.created_at > m.created_at
            and r.created_at <= m.created_at + make_interval(hours => ${settings.replyWindowHours})
        )) as is_replied,
        (cr.status = 'sent' and ct.wa_consent = 'opt_out'
          and ct.wa_consent_at >= coalesce(cr.sent_at, m.created_at)) as is_opt_out,
        coalesce(m.error_code, cr.error_code) as error_code,
        coalesce(nullif(m.error, ''), cr.error_message) as error_text
      from campaign_recipient cr
      join campaign c on c.organization_id = cr.organization_id and c.id = cr.campaign_id
      left join message m on m.organization_id = cr.organization_id and m.id = cr.message_id
      left join contact ct on ct.organization_id = cr.organization_id and ct.id = cr.contact_id
      where cr.organization_id = ${organizationId}
        and cr.status in ('sent', 'failed')
        and (${phone}::text is null or c.phone_number_id = ${phone})
    ),
    scoped_facts as (
      select * from facts
      where at >= ${period.start.toISOString()}::timestamptz at time zone 'UTC'
        and at < ${period.end.toISOString()}::timestamptz at time zone 'UTC'
    )
  `;
  const funnelCols = sql`
    count(*) filter (where is_sent)::int as sent,
    count(*) filter (where is_delivered)::int as delivered,
    count(*) filter (where is_read)::int as read,
    count(*) filter (where is_replied)::int as replied,
    count(*) filter (where is_failed)::int as failed,
    count(*) filter (where is_opt_out)::int as opt_outs
  `;
  const bucketExpr = sql.raw(byMonth ? "'YYYY-MM'" : "'YYYY-MM-DD'");

  const [totalsRows, seriesRows, perCampaignRows, failureRows] = await Promise.all([
    db.execute(sql`${facts} select ${funnelCols} from scoped_facts`),
    db.execute(sql`${facts}
      select to_char((at at time zone 'UTC' at time zone ${period.timezone}), ${bucketExpr}) as bucket, ${funnelCols}
      from scoped_facts group by 1 order by 1`),
    db.execute(sql`${facts}
      select campaign_id, ${funnelCols} from scoped_facts group by campaign_id`),
    db.execute(sql`${facts}
      select error_code, max(error_text) as error_text, count(*)::int as n
      from scoped_facts where is_failed group by error_code order by n desc limit 20`),
  ]);

  const totals = toFunnel((totalsRows as unknown as FunnelRow[])[0]);

  const seriesMap = new Map(
    (seriesRows as unknown as (FunnelRow & { bucket: string })[]).map((r) => [r.bucket, toFunnel(r)])
  );
  const series = bucketsDelPeriodo(period.dto).map((bucket) => ({ bucket, ...(seriesMap.get(bucket) ?? emptyFunnel()) }));

  const failureReasons: FailureReason[] = (
    failureRows as unknown as { error_code: number | null; error_text: string | null; n: number }[]
  ).map((r) => ({
    code: r.error_code === null ? null : Number(r.error_code),
    reason: describeSendError(r.error_code === null ? null : Number(r.error_code), r.error_text),
    count: Number(r.n),
  }));

  // Datos de cada campaña con actividad en el periodo.
  const perCampaign = new Map(
    (perCampaignRows as unknown as (FunnelRow & { campaign_id: string })[]).map((r) => [r.campaign_id, toFunnel(r)])
  );
  const campaigns: CampaignMetricsRow[] = [];
  if (perCampaign.size > 0) {
    const rows = await db
      .select({
        id: schema.campaign.id,
        name: schema.campaign.name,
        status: schema.campaign.status,
        startedAt: schema.campaign.startedAt,
        createdAt: schema.campaign.createdAt,
        total: schema.campaign.total,
        estimatedCost: schema.campaign.estimatedCost,
        phoneNumberId: schema.campaign.phoneNumberId,
        templateName: schema.template.name,
        category: schema.template.category,
      })
      .from(schema.campaign)
      .leftJoin(
        schema.template,
        sql`${schema.template.organizationId} = ${schema.campaign.organizationId} and ${schema.template.id} = ${schema.campaign.templateId}`
      )
      .where(scoped(schema.campaign.organizationId, organizationId, inArray(schema.campaign.id, [...perCampaign.keys()])));
    for (const c of rows) {
      const f = perCampaign.get(c.id) ?? emptyFunnel();
      campaigns.push({
        id: c.id,
        name: c.name,
        status: c.status,
        startedAt: (c.startedAt ?? c.createdAt).toISOString(),
        templateName: c.templateName,
        category: c.category,
        phoneNumberId: c.phoneNumberId,
        ...f,
        estimatedCost: campaignEstimatedCost({
          launchEstimate: c.estimatedCost === null ? null : Number(c.estimatedCost),
          total: c.total,
          sent: f.sent,
          rate: settings.rates[(c.category ?? "").toLowerCase()],
        }),
      });
    }
    campaigns.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  }

  const estimatedParts = campaigns.map((c) => c.estimatedCost).filter((v): v is number => v !== null);
  const estimated = estimatedParts.length ? Math.round(estimatedParts.reduce((s, v) => s + v, 0) * 10_000) / 10_000 : null;

  // Lo reportado por Meta: días UTC (así los corta Meta) del periodo local.
  const pricing = (await db.execute(sql`
    select pricing_category as category, sum(volume)::int as volume, sum(cost)::float8 as cost, max(currency) as currency
    from wa_pricing_analytics_daily
    where organization_id = ${organizationId}
      and day >= ${period.dto.from}::date and day <= ${period.dto.to}::date
      and (${phone}::text is null or phone_number_id in (${phone}, ''))
    group by pricing_category order by cost desc
  `)) as unknown as { category: string; volume: number; cost: number; currency: string | null }[];
  const byCategory = pricing.map((p) => ({ category: p.category || "SIN CATEGORÍA", volume: Number(p.volume), cost: Number(p.cost) }));
  const reported = byCategory.length ? Math.round(byCategory.reduce((s, p) => s + p.cost, 0) * 10_000) / 10_000 : null;
  const cost = reconcileCost({
    estimated,
    estimatedCurrency: settings.currency,
    reported,
    reportedCurrency: pricing.find((p) => p.currency)?.currency ?? null,
    byCategory,
  });

  const templates = (
    (await db.execute(sql`
      select a.wa_template_id, max(t.name) as name, sum(a.sent)::int as sent, sum(a.delivered)::int as delivered,
        sum(a.read)::int as read, sum(a.clicked)::int as clicked
      from wa_template_analytics_daily a
      left join template t on t.organization_id = a.organization_id and t.wa_template_id = a.wa_template_id
      where a.organization_id = ${organizationId}
        and a.day >= ${period.dto.from}::date and a.day <= ${period.dto.to}::date
      group by a.wa_template_id order by sent desc limit 50
    `)) as unknown as { wa_template_id: string; name: string | null; sent: number; delivered: number; read: number; clicked: number }[]
  ).map((r) => ({
    waTemplateId: r.wa_template_id,
    name: r.name,
    sent: Number(r.sent),
    delivered: Number(r.delivered),
    read: Number(r.read),
    clicked: Number(r.clicked),
  }));

  return {
    period: period.dto,
    phoneNumberId: phone,
    phoneOptions: await phoneOptions(organizationId),
    replyWindowHours: settings.replyWindowHours,
    totals,
    failureReasons,
    series,
    campaigns,
    cost,
    templates,
    sync: await syncInfo(organizationId),
  };
}

/** Números para el filtro: el conectado hoy y los que enviaron campañas. */
async function phoneOptions(organizationId: string): Promise<{ id: string; label: string }[]> {
  const out = new Map<string, string>();
  const creds = await getOrgCredentials(organizationId, "whatsapp");
  if (creds.ok) out.set(creds.value.phoneNumberId, creds.value.displayPhoneNumber ?? creds.value.phoneNumberId);
  const rows = await getDb()
    .selectDistinct({ id: schema.campaign.phoneNumberId })
    .from(schema.campaign)
    .where(scoped(schema.campaign.organizationId, organizationId, sql`${schema.campaign.phoneNumberId} is not null`));
  for (const r of rows) if (r.id && !out.has(r.id)) out.set(r.id, r.id);
  return [...out].map(([id, label]) => ({ id, label }));
}

async function syncInfo(organizationId: string): Promise<{ template: MetaSyncInfo; pricing: MetaSyncInfo }> {
  const rows = await getDb()
    .select()
    .from(schema.waAnalyticsSync)
    .where(scoped(schema.waAnalyticsSync.organizationId, organizationId));
  const pick = (kind: "template" | "pricing"): MetaSyncInfo => {
    // Una WABA por organización hoy; con varias, la del intento más reciente.
    const r = rows.filter((x) => x.kind === kind).sort((a, b) => b.attemptedAt.getTime() - a.attemptedAt.getTime())[0];
    if (!r) return { status: "never", syncedAt: null, attemptedAt: null, error: null };
    return {
      status: r.status,
      syncedAt: r.syncedAt?.toISOString() ?? null,
      attemptedAt: r.attemptedAt.toISOString(),
      error: r.error,
    };
  };
  return { template: pick("template"), pricing: pick("pricing") };
}
