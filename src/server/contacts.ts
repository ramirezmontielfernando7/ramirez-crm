import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scopedContacts, type Access } from "@/lib/db/tenant";
import { assignContacts } from "@/server/assignment/assign";
import { createLeadForContact } from "@/server/inbox/lead-activity";
import { effectiveSource } from "@/server/contact-source";
import type { FichaDto, PriorityValue } from "@/lib/types";
import type { TagDto } from "@/lib/tags";

export function serializeContact(
  c: typeof schema.contact.$inferSelect,
  stageName: string | null = null,
  priority: PriorityValue | null = null,
  /** 018: si llegó por un anuncio, la fuente no capturada se deduce "anuncio". */
  llegoPorAnuncio = false,
  /** 021: sus etiquetas; ausentes = quien llama no las cargó. */
  tags?: TagDto[]
) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    notes: c.notes,
    stageName,
    archivedAt: c.archivedAt?.toISOString() ?? null,
    source: effectiveSource(c.source, llegoPorAnuncio),
    priority,
    /** 020: quién lo atiende; null = sin asignar. */
    assignedUserId: c.assignedUserId,
    assignedAt: c.assignedAt?.toISOString() ?? null,
    // Viaja siempre, aunque esté vacía: la pantalla necesita distinguir "aún
    // no la han llenado" de "este contacto no la trae".
    ficha: (c.ficha as FichaDto | null) ?? {},
    // 021: consentimiento para envíos masivos.
    waConsent: c.waConsent,
    waConsentSource: c.waConsentSource,
    waConsentAt: c.waConsentAt?.toISOString() ?? null,
    ...(tags ? { tags } : {}),
  };
}

/** El contacto, SOLO si la sesión puede verlo (020); si no, null → 404. */
export async function getContactById(access: Access, contactId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.contact)
    .where(
      scopedContacts(
        schema.contact.organizationId,
        access,
        schema.contact.id,
        eq(schema.contact.id, contactId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Etapa actual del lead del contacto (si existe). */
export async function getContactStage(access: Access, contactId: string) {
  const db = getDb();
  const rows = await db
    .select({ stage: schema.pipelineStage, lead: schema.lead })
    .from(schema.lead)
    .innerJoin(
      schema.pipelineStage,
      eq(schema.lead.stageId, schema.pipelineStage.id)
    )
    .where(
      scopedContacts(
        schema.lead.organizationId,
        access,
        schema.lead.contactId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Alta manual de un contacto de WhatsApp con su lead. La comparten
 * `POST /api/contacts` y «Número no registrado» de la Bandeja: así el alta
 * se comporta igual venga de donde venga.
 *
 * `phone` ya viene normalizado (521→52). Quien ve a todo el equipo puede
 * dejarlo sin asignar o dárselo a alguien (`assignToUserId`); quien no, se lo
 * queda (020) — si no, lo daría de alta y dejaría de verlo al instante.
 */
export async function createContactWithLead(input: {
  organizationId: string;
  actorUserId: string;
  seesAll: boolean;
  name: string;
  phone: string;
  notes?: string | null;
  source?: "anuncio" | "organico" | "referido" | "conocido" | "otro" | null;
  stageId?: string;
  assignToUserId?: string | null;
}): Promise<
  | { ok: true; contact: typeof schema.contact.$inferSelect; leadId: string }
  | { ok: false; reason: "duplicate" | "no_stage" | "assignee_not_member" }
> {
  const db = getDb();
  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId: input.organizationId,
      name: input.name,
      phone: input.phone,
      waIdentity: input.phone,
      notes: input.notes ?? null,
      source: input.source ?? null,
    })
    // El canal entra en el target porque entra en el índice único desde 014
    // (`contact_org_channel_identity_uq`). Postgres exige que el ON CONFLICT
    // nombre EXACTAMENTE las columnas de un índice existente: sin `channel`,
    // el alta manual falla con "no unique or exclusion constraint matching".
    .onConflictDoNothing({
      target: [
        schema.contact.organizationId,
        schema.contact.channel,
        schema.contact.waIdentity,
      ],
    })
    .returning();
  if (!inserted[0]) return { ok: false, reason: "duplicate" };

  // Y su lead: un contacto sin lead es invisible en el Pipeline, que es la
  // pantalla donde se trabaja el embudo. Dar de alta a alguien y no verlo ahí
  // es la mitad de la función.
  const lead = await createLeadForContact({
    organizationId: input.organizationId,
    contactId: inserted[0].id,
    stageId: input.stageId,
    source: "dueno",
    actorUserId: input.actorUserId,
  });
  if (!lead) return { ok: false, reason: "no_stage" };

  let contact = inserted[0];
  const toUserId = input.seesAll ? (input.assignToUserId ?? null) : input.actorUserId;
  if (toUserId) {
    const res = await assignContacts({
      organizationId: input.organizationId,
      contactIds: [contact.id],
      toUserId,
      actorUserId: input.actorUserId,
      source: "manual",
      reason: "Alta manual",
    });
    if (!res.ok) return { ok: false, reason: "assignee_not_member" };
    contact = { ...contact, assignedUserId: toUserId, assignedAt: new Date() };
  }
  return { ok: true, contact, leadId: lead.id };
}
