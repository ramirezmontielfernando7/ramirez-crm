import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { countVariables } from "@/lib/templates";
import type {
  CampaignAudience,
  CampaignCounts,
  CampaignDto,
  CampaignRecipientDto,
  CampaignVariable,
  RecipientStatus,
} from "@/lib/campaigns";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { audienceContacts } from "@/server/campaigns/audience";
import { startCampaignRunner } from "@/server/campaigns/runner";

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
    | "conflict";
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
    const c = out.get(r.campaignId) ?? { pending: 0, sent: 0, failed: 0 };
    c[r.status] = Number(r.n);
    out.set(r.campaignId, c);
  }
  return out;
}

function serializeCampaign(
  c: CampaignRow,
  template: TemplateRow | null,
  counts: CampaignCounts | undefined
): CampaignDto {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    template: template
      ? { id: template.id, name: template.name, language: template.language, body: template.body }
      : null,
    variables: c.variables as CampaignVariable[],
    audience: c.audience as CampaignAudience,
    total: c.total,
    counts: counts ?? { pending: 0, sent: 0, failed: 0 },
    error: c.error,
    createdBy: c.createdBy,
    createdAt: c.createdAt.toISOString(),
    startedAt: c.startedAt?.toISOString() ?? null,
    finishedAt: c.finishedAt?.toISOString() ?? null,
  };
}

export async function listCampaigns(organizationId: string): Promise<CampaignDto[]> {
  const rows = await getDb()
    .select({ campaign: schema.campaign, template: schema.template })
    .from(schema.campaign)
    .leftJoin(schema.template, eq(schema.template.id, schema.campaign.templateId))
    .where(scoped(schema.campaign.organizationId, organizationId))
    .orderBy(desc(schema.campaign.createdAt))
    .limit(200);
  const counts = await countsFor(rows.map((r) => r.campaign.id));
  return rows.map((r) => serializeCampaign(r.campaign, r.template, counts.get(r.campaign.id)));
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
  const counts = await countsFor([campaignId]);
  return serializeCampaign(row.campaign, row.template, counts.get(campaignId));
}

export async function listRecipients(
  organizationId: string,
  campaignId: string,
  opts: { status?: RecipientStatus; limit?: number; offset?: number } = {}
): Promise<CampaignRecipientDto[]> {
  await getCampaign(organizationId, campaignId); // 404 si no es de este negocio
  const rows = await getDb()
    .select()
    .from(schema.campaignRecipient)
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
  return rows.map((r) => ({
    id: r.id,
    contactId: r.contactId,
    contactName: r.contactName,
    phone: r.phone,
    status: r.status,
    errorMessage: r.errorMessage,
    sentAt: r.sentAt?.toISOString() ?? null,
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
  return t;
}

/** Exactamente una variable por {{n}}; un texto fijo no puede ir vacío. */
function validateVariables(template: TemplateRow, variables: CampaignVariable[]): CampaignVariable[] {
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
  const variables = validateVariables(template, input.variables);
  if (input.audience.tagIds?.length) {
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
      audience: input.audience,
      createdBy: input.userId,
      status: "draft",
    })
    .returning();
  return serializeCampaign(inserted[0]!, template, undefined);
}

/**
 * Lanza el envío: congela la lista de destinatarios (los `opt_in` que cumplen
 * el filtro EN ESTE MOMENTO), pasa la campaña a `sending` y arranca el
 * ejecutor en segundo plano. El POST responde de inmediato.
 *
 * Doble clic / dos pestañas: el paso `draft → sending` es condicional en la
 * BD, así que solo uno lo logra; el otro recibe 409.
 */
export async function launchCampaign(organizationId: string, campaignId: string): Promise<CampaignDto> {
  const current = await getCampaign(organizationId, campaignId);
  if (current.status !== "draft") {
    throw new CampaignError("conflict", "Esta campaña ya se envió");
  }
  // Se re-verifica: la plantilla pudo pausarse/rechazarse desde el borrador.
  await approvedTemplate(organizationId, current.template?.id ?? "");
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) throw new CampaignError("not_connected", "Conecta tu número de WhatsApp antes de enviar");
  if (creds.status === "reconnect_required") {
    throw new CampaignError("not_connected", "El token de WhatsApp expiró: reconecta el número antes de enviar");
  }

  const contacts = await audienceContacts(organizationId, current.audience);
  if (contacts.length === 0) {
    throw new CampaignError(
      "no_recipients",
      "Ningún contacto del público tiene consentimiento (opt_in): no hay a quién enviar"
    );
  }

  const db = getDb();
  const launched = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.campaign)
      .set({ status: "sending", total: contacts.length, startedAt: new Date(), error: null })
      .where(
        and(
          eq(schema.campaign.id, campaignId),
          eq(schema.campaign.organizationId, organizationId),
          eq(schema.campaign.status, "draft")
        )
      )
      .returning({ id: schema.campaign.id });
    if (!updated[0]) return false;
    for (let i = 0; i < contacts.length; i += 500) {
      await tx
        .insert(schema.campaignRecipient)
        .values(
          contacts.slice(i, i + 500).map((c) => ({
            id: newId("campaignRecipient"),
            organizationId,
            campaignId,
            contactId: c.id,
            contactName: c.name,
            phone: c.phone,
          }))
        )
        .onConflictDoNothing();
    }
    return true;
  });
  if (!launched) throw new CampaignError("conflict", "Esta campaña ya se envió");

  startCampaignRunner(organizationId, campaignId);
  return getCampaign(organizationId, campaignId);
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
