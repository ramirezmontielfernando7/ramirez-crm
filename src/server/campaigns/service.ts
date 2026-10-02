import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { countVariables } from "@/lib/templates";
import { parseMessagingLimit } from "@/lib/phone-health";
import { emptyCounts, resolveVariables } from "@/lib/campaigns";
import type {
  CampaignAudience,
  CampaignCounts,
  CampaignDelivery,
  CampaignDto,
  CampaignPreview,
  CampaignRecipientDto,
  CampaignVariable,
  ExclusionReason,
  RecipientStatus,
} from "@/lib/campaigns";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { sendTemplate, templateSendability, TemplateError } from "@/server/whatsapp/templates";
import { getHealthSummary } from "@/server/whatsapp/health";
import { getOrCreateContact, getOrCreateConversation } from "@/server/inbox/ingest";
import { SendError } from "@/server/inbox/send";
import { parseImportPhone } from "@/server/contacts-io/validate";
import { audienceBreakdown, audienceContacts } from "@/server/campaigns/audience";
import { estimateCost, getCampaignSettings } from "@/server/campaigns/settings";
import { ensureDispatcher } from "@/server/campaigns/dispatcher";
import { cancelCampaign, pauseCampaign, resumeCampaign } from "@/server/campaigns/lifecycle";
import { humanMetaError } from "@/server/campaigns/outcome";

/**
 * 021 — Campañas: crear (borrador), lanzar y consultar.
 *
 * Todo es del negocio entero: las rutas exigen `campaigns.manage`, que solo
 * tienen roles que ven todo, así que aquí se usa `scoped()` (tenant) y no el
 * filtro por asignación.
 */

export class CampaignError extends Error {
  code:
    | "invalid"
    | "not_found"
    | "template_not_approved"
    | "no_recipients"
    | "not_connected"
    | "conflict"
    | "rate_limited"
    | "send_failed";
  constructor(code: CampaignError["code"], message: string) {
    super(message);
    this.name = "CampaignError";
    this.code = code;
  }
}

export const CAMPAIGN_ERROR_STATUS: Record<CampaignError["code"], number> = {
  invalid: 422,
  not_found: 404,
  template_not_approved: 422,
  no_recipients: 422,
  not_connected: 409,
  conflict: 409,
  rate_limited: 429,
  send_failed: 502,
};

type CampaignRow = typeof schema.campaign.$inferSelect;
type TemplateRow = typeof schema.template.$inferSelect;

async function countsFor(campaignIds: string[]): Promise<Map<string, CampaignCounts>> {
  const out = new Map<string, CampaignCounts>();
  if (campaignIds.length === 0) return out;
  const rows = await getDb()
    .select({
      campaignId: schema.campaignRecipient.campaignId,
      status: schema.campaignRecipient.status,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.campaignRecipient)
    .where(inArray(schema.campaignRecipient.campaignId, campaignIds))
    .groupBy(schema.campaignRecipient.campaignId, schema.campaignRecipient.status);
  for (const r of rows) {
    const c = out.get(r.campaignId) ?? emptyCounts();
    c[r.status] = Number(r.n);
    out.set(r.campaignId, c);
  }
  return out;
}

/**
 * Campañas v2 — conteo por estado de ENTREGA, derivado del mensaje de cada
 * destinatario (no se duplica en campaign_recipient).
 */
async function deliveryFor(organizationId: string, campaignIds: string[]): Promise<Map<string, CampaignDelivery>> {
  const out = new Map<string, CampaignDelivery>();
  if (campaignIds.length === 0) return out;
  const rows = await getDb()
    .select({
      campaignId: schema.campaignRecipient.campaignId,
      status: schema.message.status,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.campaignRecipient)
    .innerJoin(
      schema.message,
      and(
        eq(schema.message.organizationId, schema.campaignRecipient.organizationId),
        eq(schema.message.id, schema.campaignRecipient.messageId)
      )
    )
    .where(
      scoped(schema.campaignRecipient.organizationId, organizationId, inArray(schema.campaignRecipient.campaignId, campaignIds))
    )
    .groupBy(schema.campaignRecipient.campaignId, schema.message.status);
  for (const r of rows) {
    const d = out.get(r.campaignId) ?? { delivered: 0, read: 0, failed: 0 };
    const n = Number(r.n);
    if (r.status === "delivered" || r.status === "read") d.delivered += n;
    if (r.status === "read") d.read += n;
    if (r.status === "failed") d.failed += n;
    out.set(r.campaignId, d);
  }
  return out;
}

function serializeCampaign(
  c: CampaignRow,
  template: TemplateRow | null,
  counts: CampaignCounts | undefined,
  delivery: CampaignDelivery | undefined,
  audienceName: string | null = null
): CampaignDto {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    template: template
      ? { id: template.id, name: template.name, language: template.language, body: template.body, category: template.category }
      : null,
    variables: c.variables as CampaignVariable[],
    audience: c.audience as CampaignAudience,
    total: c.total,
    counts: counts ?? emptyCounts(),
    delivery: delivery ?? { delivered: 0, read: 0, failed: 0 },
    error: c.error,
    createdBy: c.createdBy,
    createdAt: c.createdAt.toISOString(),
    startedAt: c.startedAt?.toISOString() ?? null,
    finishedAt: c.finishedAt?.toISOString() ?? null,
    scheduledAt: c.scheduledAt?.toISOString() ?? null,
    pauseReason: c.pauseReason,
    autoPaused: c.autoPaused,
    resumeAt: c.resumeAt?.toISOString() ?? null,
    estimatedCost: c.estimatedCost ?? null,
    costCurrency: c.costCurrency,
    excluded: (c.excluded as Partial<Record<ExclusionReason, number>> | null) ?? null,
    testSentAt: c.testSentAt?.toISOString() ?? null,
    audienceName,
  };
}

async function audienceNames(organizationId: string, rows: CampaignRow[]): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      rows.map((r) => (r.audience as CampaignAudience).importId).filter((x): x is string => typeof x === "string")
    ),
  ];
  if (ids.length === 0) return new Map();
  const found = await getDb()
    .select({ id: schema.audienceImport.id, name: schema.audienceImport.name })
    .from(schema.audienceImport)
    .where(scoped(schema.audienceImport.organizationId, organizationId, inArray(schema.audienceImport.id, ids)));
  return new Map(found.map((f) => [f.id, f.name]));
}

export async function listCampaigns(organizationId: string): Promise<CampaignDto[]> {
  const rows = await getDb()
    .select({ campaign: schema.campaign, template: schema.template })
    .from(schema.campaign)
    .leftJoin(schema.template, eq(schema.template.id, schema.campaign.templateId))
    .where(scoped(schema.campaign.organizationId, organizationId))
    .orderBy(desc(schema.campaign.createdAt))
    .limit(200);
  const ids = rows.map((r) => r.campaign.id);
  const [counts, delivery, names] = await Promise.all([
    countsFor(ids),
    deliveryFor(organizationId, ids),
    audienceNames(organizationId, rows.map((r) => r.campaign)),
  ]);
  return rows.map((r) =>
    serializeCampaign(
      r.campaign,
      r.template,
      counts.get(r.campaign.id),
      delivery.get(r.campaign.id),
      names.get((r.campaign.audience as CampaignAudience).importId ?? "") ?? null
    )
  );
}

export async function getCampaign(organizationId: string, campaignId: string): Promise<CampaignDto> {
  const rows = await getDb()
    .select({ campaign: schema.campaign, template: schema.template })
    .from(schema.campaign)
    .leftJoin(schema.template, eq(schema.template.id, schema.campaign.templateId))
    .where(scoped(schema.campaign.organizationId, organizationId, eq(schema.campaign.id, campaignId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new CampaignError("not_found", "Campaña no encontrada");
  const [counts, delivery, names] = await Promise.all([
    countsFor([campaignId]),
    deliveryFor(organizationId, [campaignId]),
    audienceNames(organizationId, [row.campaign]),
  ]);
  return serializeCampaign(
    row.campaign,
    row.template,
    counts.get(campaignId),
    delivery.get(campaignId),
    names.get((row.campaign.audience as CampaignAudience).importId ?? "") ?? null
  );
}

export async function listRecipients(
  organizationId: string,
  campaignId: string,
  opts: { status?: RecipientStatus; limit?: number; offset?: number } = {}
): Promise<CampaignRecipientDto[]> {
  await getCampaign(organizationId, campaignId); // 404 si no es de este negocio
  const rows = await getDb()
    .select({ r: schema.campaignRecipient, m: schema.message })
    .from(schema.campaignRecipient)
    .leftJoin(
      schema.message,
      and(
        eq(schema.message.organizationId, schema.campaignRecipient.organizationId),
        eq(schema.message.id, schema.campaignRecipient.messageId)
      )
    )
    .where(
      scoped(
        schema.campaignRecipient.organizationId,
        organizationId,
        eq(schema.campaignRecipient.campaignId, campaignId),
        opts.status ? eq(schema.campaignRecipient.status, opts.status) : undefined
      )
    )
    .orderBy(schema.campaignRecipient.contactName)
    .limit(Math.min(opts.limit ?? 500, 20_000))
    .offset(opts.offset ?? 0);
  return rows.map(({ r, m }) => ({
    id: r.id,
    contactId: r.contactId,
    contactName: r.contactName,
    phone: r.phone,
    status: r.status,
    errorMessage: r.errorMessage,
    sentAt: r.sentAt?.toISOString() ?? null,
    delivery: m
      ? {
          status: m.status,
          deliveredAt: m.deliveredAt?.toISOString() ?? null,
          readAt: m.readAt?.toISOString() ?? null,
          error: m.status === "failed" ? m.error : null,
        }
      : null,
  }));
}

/**
 * La plantilla, SOLO si está aprobada por Meta. Una pendiente o rechazada no
 * es elegible: Meta la rechazaría en cada envío.
 */
async function approvedTemplate(organizationId: string, templateId: string): Promise<TemplateRow> {
  const rows = await getDb()
    .select()
    .from(schema.template)
    .where(scoped(schema.template.organizationId, organizationId, eq(schema.template.id, templateId)))
    .limit(1);
  const t = rows[0];
  if (!t) throw new CampaignError("not_found", "Plantilla no encontrada");
  if (t.status !== "approved") {
    throw new CampaignError(
      "template_not_approved",
      `La plantilla "${t.name}" no está aprobada por Meta (estado: ${t.status}). Sincroniza las plantillas o elige otra.`
    );
  }
  // Campañas v2: aprobada pero pausada o desactivada por Meta tampoco sirve.
  const sendability = templateSendability(t);
  if (!sendability.sendable) {
    throw new CampaignError("template_not_approved", `La plantilla "${t.name}" no se puede enviar: ${sendability.reason}`);
  }
  return t;
}

/**
 * Exactamente una variable por {{n}}; un texto fijo no puede ir vacío; una
 * columna debe existir en la base guardada del público.
 */
function validateVariables(
  template: TemplateRow,
  variables: CampaignVariable[],
  columns: string[] | null
): CampaignVariable[] {
  const expected = countVariables(template.body);
  if (variables.length !== expected) {
    throw new CampaignError(
      "invalid",
      expected === 0
        ? "Esta plantilla no lleva variables"
        : `La plantilla lleva ${expected} variable(s) y se recibieron ${variables.length}`
    );
  }
  return variables.map((v, i) => {
    if (v.kind === "contact_name") return v;
    if (v.kind === "column") {
      if (!columns) {
        throw new CampaignError("invalid", `{{${i + 1}}}: las columnas solo existen si el público es una base subida`);
      }
      if (!columns.includes(v.column)) {
        throw new CampaignError("invalid", `{{${i + 1}}}: la base no tiene la columna "${v.column}"`);
      }
      return { kind: "column" as const, column: v.column };
    }
    const value = v.value.trim();
    if (!value) throw new CampaignError("invalid", `Falta el valor de {{${i + 1}}}`);
    if (value.length > 500) throw new CampaignError("invalid", `{{${i + 1}}} pasa de 500 caracteres`);
    // Meta rechaza parámetros con saltos de línea, tabuladores o 4+ espacios.
    if (/[\n\t]| {4,}/.test(value)) {
      throw new CampaignError("invalid", `{{${i + 1}}} no puede llevar saltos de línea, tabuladores ni 4 espacios seguidos (Meta lo rechaza)`);
    }
    return { kind: "fixed" as const, value };
  });
}

export async function createCampaign(input: {
  organizationId: string;
  userId: string;
  name: string;
  templateId: string;
  variables: CampaignVariable[];
  audience: CampaignAudience;
}): Promise<CampaignDto> {
  const name = input.name.trim();
  if (!name) throw new CampaignError("invalid", "Ponle un nombre a la campaña");
  const template = await approvedTemplate(input.organizationId, input.templateId);
  const columns = await audienceColumns(input.organizationId, input.audience);
  const variables = validateVariables(template, input.variables, columns);
  if (!input.audience.importId && input.audience.tagIds?.length) {
    const found = await getDb()
      .select({ id: schema.contactTag.id })
      .from(schema.contactTag)
      .where(
        scoped(
          schema.contactTag.organizationId,
          input.organizationId,
          inArray(schema.contactTag.id, [...new Set(input.audience.tagIds)])
        )
      );
    if (found.length !== new Set(input.audience.tagIds).size) {
      throw new CampaignError("invalid", "Alguna etiqueta del público ya no existe");
    }
  }
  const inserted = await getDb()
    .insert(schema.campaign)
    .values({
      id: newId("campaign"),
      organizationId: input.organizationId,
      templateId: template.id,
      name: name.slice(0, 120),
      variables,
      audience: input.audience.importId ? { importId: input.audience.importId } : input.audience,
      createdBy: input.userId,
      status: "draft",
    })
    .returning();
  return serializeCampaign(inserted[0]!, template, undefined, undefined);
}

/** Las columnas extra de la base del público; null si el público no es una base. 404 → invalid. */
async function audienceColumns(organizationId: string, audience: CampaignAudience): Promise<string[] | null> {
  if (!audience.importId) return null;
  const rows = await getDb()
    .select({ columns: schema.audienceImport.columns })
    .from(schema.audienceImport)
    .where(scoped(schema.audienceImport.organizationId, organizationId, eq(schema.audienceImport.id, audience.importId)))
    .limit(1);
  if (!rows[0]) throw new CampaignError("invalid", "La base elegida ya no existe");
  return rows[0].columns;
}

/** Valores de las variables para un contacto; null si falta alguno (columna vacía). */
function variablesFor(vars: CampaignVariable[], name: string, fields: Record<string, string>): string[] | null {
  const values = resolveVariables(vars, name, fields);
  return values.some((v) => !v) ? null : values;
}

/**
 * Paso 3 del asistente: cuántos recibirán, cuántos se excluyen y por qué,
 * costo ESTIMADO y margen frente al límite de 24 h del número.
 */
export async function previewCampaign(
  organizationId: string,
  input: { audience: CampaignAudience; templateId?: string | null; variables?: CampaignVariable[] }
): Promise<CampaignPreview> {
  const breakdown = await audienceBreakdown(organizationId, input.audience);
  const excluded = { ...breakdown.excluded };
  let eligible = breakdown.eligible;
  let category: string | null = null;
  if (input.templateId) {
    const t = await getDb()
      .select({ category: schema.template.category })
      .from(schema.template)
      .where(scoped(schema.template.organizationId, organizationId, eq(schema.template.id, input.templateId)))
      .limit(1);
    category = t[0]?.category ?? null;
  }
  if (input.audience.importId && input.variables?.some((v) => v.kind === "column")) {
    const contacts = await audienceContacts(organizationId, input.audience);
    const missing = contacts.filter((c) => !variablesFor(input.variables!, c.name, c.fields)).length;
    excluded.missingVariable += missing;
    eligible -= missing;
  }
  const [settings, health] = await Promise.all([getCampaignSettings(organizationId), getHealthSummary(organizationId)]);
  const limit = health.today?.messagingLimitValue ?? parseMessagingLimit(health.today?.messagingLimit ?? null);
  return {
    eligible,
    excluded,
    estimate: estimateCost(settings, category, eligible),
    limit,
    usage: health.usage,
    margin: limit === null ? null : Math.max(0, limit - health.usage),
    category,
  };
}

/** Hasta cuándo se puede programar. */
const MAX_SCHEDULE_DAYS = 60;

/**
 * Lanza o programa el envío: congela la lista de destinatarios (los `opt_in`
 * que cumplen el filtro EN ESTE MOMENTO, con sus variables ya resueltas),
 * guarda los excluidos por motivo y el costo ESTIMADO, y pasa la campaña a
 * `sending` (o `scheduled`). El POST responde de inmediato: el envío corre en
 * el despachador del número.
 *
 * Doble clic / dos pestañas: el paso desde `draft` es condicional en la BD,
 * así que solo uno lo logra; el otro recibe 409.
 */
export async function launchCampaign(
  organizationId: string,
  campaignId: string,
  opts: { scheduledAt?: Date | null } = {}
): Promise<CampaignDto> {
  const current = await getCampaign(organizationId, campaignId);
  if (current.status !== "draft") {
    throw new CampaignError("conflict", "Esta campaña ya se envió");
  }
  const scheduledAt = opts.scheduledAt ?? null;
  if (scheduledAt) {
    if (scheduledAt.getTime() < Date.now() + 60_000) {
      throw new CampaignError("invalid", "Programa el envío al menos un minuto en el futuro (o envíalo ya)");
    }
    if (scheduledAt.getTime() > Date.now() + MAX_SCHEDULE_DAYS * 86_400_000) {
      throw new CampaignError("invalid", `Solo se puede programar hasta ${MAX_SCHEDULE_DAYS} días adelante`);
    }
  }
  // Se re-verifica: la plantilla pudo pausarse/rechazarse desde el borrador.
  const template = await approvedTemplate(organizationId, current.template?.id ?? "");
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) throw new CampaignError("not_connected", "Conecta tu número de WhatsApp antes de enviar");
  if (creds.status === "reconnect_required") {
    throw new CampaignError("not_connected", "El token de WhatsApp expiró: reconecta el número antes de enviar");
  }

  const breakdown = await audienceBreakdown(organizationId, current.audience);
  const excluded = { ...breakdown.excluded };
  const contacts = await audienceContacts(organizationId, current.audience);
  const recipients: { id: string; name: string; phone: string | null; variables: string[] }[] = [];
  for (const c of contacts) {
    const values = variablesFor(current.variables, c.name, c.fields);
    if (!values) {
      excluded.missingVariable++;
      continue;
    }
    recipients.push({ id: c.id, name: c.name, phone: c.phone, variables: values });
  }
  if (recipients.length === 0) {
    throw new CampaignError(
      "no_recipients",
      contacts.length === 0
        ? "Ningún contacto del público tiene consentimiento (opt_in): no hay a quién enviar"
        : "A ningún contacto del público se le pueden llenar las variables: revisa las columnas elegidas"
    );
  }
  const settings = await getCampaignSettings(organizationId);
  const estimate = estimateCost(settings, template.category, recipients.length);

  const db = getDb();
  const launched = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.campaign)
      .set({
        status: scheduledAt ? "scheduled" : "sending",
        total: recipients.length,
        startedAt: scheduledAt ? null : new Date(),
        scheduledAt,
        phoneNumberId: creds.phoneNumberId,
        error: null,
        excluded,
        estimatedCost: estimate?.amount ?? null,
        costCurrency: estimate?.currency ?? null,
      })
      .where(
        scoped(
          schema.campaign.organizationId,
          organizationId,
          eq(schema.campaign.id, campaignId),
          eq(schema.campaign.status, "draft")
        )
      )
      .returning({ id: schema.campaign.id });
    if (!updated[0]) return false;
    for (let i = 0; i < recipients.length; i += 500) {
      await tx
        .insert(schema.campaignRecipient)
        .values(
          recipients.slice(i, i + 500).map((c) => ({
            id: newId("campaignRecipient"),
            organizationId,
            campaignId,
            contactId: c.id,
            contactName: c.name,
            phone: c.phone,
            variables: c.variables,
          }))
        )
        .onConflictDoNothing();
    }
    return true;
  });
  if (!launched) throw new CampaignError("conflict", "Esta campaña ya se envió");

  if (!scheduledAt) ensureDispatcher(organizationId, creds.phoneNumberId);
  return getCampaign(organizationId, campaignId);
}

/** Pausar / reanudar / cancelar a mano. 404 si no es de este negocio; 409 si no aplica. */
export async function setCampaignState(
  organizationId: string,
  campaignId: string,
  action: "pause" | "resume" | "cancel"
): Promise<CampaignDto> {
  const current = await getCampaign(organizationId, campaignId);
  let ok = false;
  if (action === "pause") ok = await pauseCampaign(organizationId, campaignId, { reason: "Pausada a mano", auto: false });
  if (action === "resume") ok = await resumeCampaign(organizationId, campaignId);
  if (action === "cancel") ok = await cancelCampaign(organizationId, campaignId);
  if (!ok) {
    const verbo = action === "pause" ? "pausar" : action === "resume" ? "reanudar" : "cancelar";
    throw new CampaignError("conflict", `No se puede ${verbo} una campaña en estado "${current.status}"`);
  }
  const after = await getCampaign(organizationId, campaignId);
  const creds = await getCredentialsByOrg(organizationId);
  if (after.status === "sending" && creds) ensureDispatcher(organizationId, creds.phoneNumberId);
  return after;
}

/** Entre dos pruebas de la misma campaña. */
const TEST_COOLDOWN_MS = 10_000;

/**
 * Envío de prueba a un número propio: el mismo mensaje (con las variables de
 * un destinatario de ejemplo), registrado en el chat de ese número. NO cuenta
 * en la campaña ni cambia el consentimiento de nadie.
 */
export async function sendCampaignTest(
  organizationId: string,
  campaignId: string,
  rawPhone: string
): Promise<{ messageId: string; to: string }> {
  const current = await getCampaign(organizationId, campaignId);
  if (!current.template) throw new CampaignError("invalid", "La campaña no tiene plantilla");
  if (current.testSentAt && Date.now() - new Date(current.testSentAt).getTime() < TEST_COOLDOWN_MS) {
    throw new CampaignError("rate_limited", "Espera unos segundos entre una prueba y otra");
  }
  const phone = parseImportPhone(rawPhone);
  if ("error" in phone) throw new CampaignError("invalid", phone.error);
  await approvedTemplate(organizationId, current.template.id);

  // Variables de ejemplo: las de un destinatario real si la base las tiene.
  let sample: Record<string, string> = {};
  if (current.audience.importId && current.variables.some((v) => v.kind === "column")) {
    const contacts = await audienceContacts(organizationId, current.audience);
    sample = contacts.find((c) => variablesFor(current.variables, c.name, c.fields))?.fields ?? {};
  }
  const values = resolveVariables(current.variables, "Prueba", sample).map(
    (v, i) => v || (current.variables[i]?.kind === "column" ? `[${(current.variables[i] as { column: string }).column}]` : "ejemplo")
  );

  const { contact } = await getOrCreateContact(organizationId, phone.phone, "Prueba de campaña");
  const conversation = await getOrCreateConversation(organizationId, contact.id);
  try {
    const { messageId } = await sendTemplate({
      organizationId,
      conversationId: conversation.id,
      templateId: current.template.id,
      variables: values,
    });
    await getDb()
      .update(schema.campaign)
      .set({ testSentAt: new Date() })
      .where(scoped(schema.campaign.organizationId, organizationId, eq(schema.campaign.id, campaignId)));
    return { messageId, to: phone.phone };
  } catch (err) {
    if (err instanceof SendError) {
      throw new CampaignError("send_failed", humanMetaError(err.metaCode ?? null, err.message));
    }
    if (err instanceof TemplateError) throw new CampaignError("send_failed", err.message);
    throw err;
  }
}

/** Borra un BORRADOR (lo enviado es registro de auditoría: no se borra). */
export async function deleteDraft(organizationId: string, campaignId: string): Promise<void> {
  const deleted = await getDb()
    .delete(schema.campaign)
    .where(
      scoped(
        schema.campaign.organizationId,
        organizationId,
        eq(schema.campaign.id, campaignId),
        eq(schema.campaign.status, "draft")
      )
    )
    .returning({ id: schema.campaign.id });
  if (!deleted[0]) {
    await getCampaign(organizationId, campaignId); // 404 si no existe
    throw new CampaignError("conflict", "Solo se pueden borrar borradores: una campaña enviada es su registro");
  }
}
