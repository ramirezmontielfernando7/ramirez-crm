import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scopedContacts, type Access } from "@/lib/db/tenant";
import { normalizeMx } from "@/lib/meta/client";
import { serializeContact } from "@/server/contacts";
import {
  contactFilterConditions,
  contactSearchCondition,
  filterFromSearchParams,
} from "@/server/contact-filter";
import { tagsForContacts } from "@/server/tags/tags";
import { assignContacts } from "@/server/assignment/assign";
import { createLeadForContact } from "@/server/inbox/lead-activity";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const stage = url.searchParams.get("stage")?.trim();
  const includeArchived = url.searchParams.get("archived") === "true";
  // 021: filtros por etiqueta, fuente y consentimiento (los mismos del CSV).
  const filter = filterFromSearchParams(url.searchParams);
  if ("error" in filter) return apiError(422, "invalid_filter", filter.error);

  const db = getDb();

  // Etapa de cada contacto en una consulta aparte: una subconsulta
  // correlacionada aquí choca con el `id` de `lead` ("column reference id is
  // ambiguous"), y un join duplicaría contactos con más de un lead.
  const leadStages = await db
    .select({
      contactId: schema.lead.contactId,
      stageName: schema.pipelineStage.name,
      priority: schema.lead.priority,
    })
    .from(schema.lead)
    .innerJoin(
      schema.pipelineStage,
      eq(schema.pipelineStage.id, schema.lead.stageId)
    )
    .where(
      scopedContacts(schema.lead.organizationId, session.access, schema.lead.contactId)
    );
  const stageByContact = new Map(
    leadStages.map((r) => [r.contactId, r.stageName])
  );
  const priorityByContact = new Map(
    leadStages.map((r) => [r.contactId, r.priority])
  );

  const search = contactSearchCondition(q);

  // El filtro de etapa se aplica ANTES del límite: si no, un contacto de la
  // etapa buscada podría quedar fuera por el corte de 200.
  const stageContactIds = stage
    ? leadStages.filter((r) => r.stageName === stage).map((r) => r.contactId)
    : null;
  if (stageContactIds?.length === 0) return Response.json({ contacts: [] });

  const rows = await db
    .select()
    .from(schema.contact)
    .where(
      scopedContacts(
        schema.contact.organizationId,
        session.access,
        schema.contact.id,
        search,
        stageContactIds ? inArray(schema.contact.id, stageContactIds) : undefined,
        ...contactFilterConditions(filter)
      )
    )
    .orderBy(desc(schema.contact.updatedAt))
    .limit(200);

  const visible = rows.filter((c) => includeArchived || !c.archivedAt);
  const tagsByContact = await tagsForContacts(
    session.organizationId,
    visible.map((c) => c.id)
  );
  const contacts = visible.map((c) =>
    serializeContact(
      c,
      stageByContact.get(c.id) ?? null,
      priorityByContact.get(c.id) ?? null,
      false,
      tagsByContact.get(c.id) ?? []
    )
  );
  return Response.json({ contacts });
});

/** 020 — Lo que ve un asesor cuando el teléfono choca con un contacto que NO es suyo. */
const DUPLICADO_GENERICO =
  "No se pudo crear el contacto, verifica los datos e intenta de nuevo";

/**
 * 020 — El teléfono ya existe. Decir "ya existe" solo a quien puede ver ese
 * contacto (propietario, coordinador o el asesor asignado): a un asesor sin
 * acceso le confirmaría que el cliente de otro está en la base. Para él la
 * respuesta es la de un dato inválido — mismo estado (422), mismo código —,
 * sin rastro de que el número exista.
 */
async function respuestaDeDuplicado(access: Access, phone: string): Promise<Response> {
  const visible = await getDb()
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      scopedContacts(
        schema.contact.organizationId,
        access,
        schema.contact.id,
        eq(schema.contact.channel, "whatsapp"),
        eq(schema.contact.waIdentity, phone)
      )
    )
    .limit(1);
  if (visible[0]) {
    return apiError(409, "duplicate", "Ya existe un contacto con ese teléfono");
  }
  return apiError(422, "invalid", DUPLICADO_GENERICO);
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /**
   * EXIGE código de país. Un número local crearía un contacto que jamás casaría
   * con los mensajes entrantes —Meta siempre manda la identidad completa— y el
   * dueño acabaría con dos fichas de la misma persona. No se asume un país:
   * diez dígitos son válidos en varios, y asumir mal produce un número
   * silenciosamente equivocado.
   */
  phone: z
    .string()
    .trim()
    .regex(/^\d{7,15}$/, "Teléfono en dígitos, con código de país (ej. 5215512345678)"),
  notes: z.string().max(4000).optional(),
  source: z.enum(["anuncio", "organico", "referido", "conocido", "otro"]).optional(),
  /** Etapa inicial del lead; si no viene, la primera abierta del tablero. */
  stageId: z.string().min(1).optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  // 003: la identidad WhatsApp se deriva del teléfono normalizado.
  const phone = normalizeMx(body.data.phone);
  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId: session.organizationId,
      name: body.data.name,
      phone,
      waIdentity: phone,
      notes: body.data.notes ?? null,
      source: body.data.source ?? null,
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
  if (!inserted[0]) {
    return respuestaDeDuplicado(session.access, phone);
  }

  // Y su lead: un contacto sin lead es invisible en el Pipeline, que es la
  // pantalla donde se trabaja el embudo. Dar de alta a alguien y no verlo ahí
  // es la mitad de la función.
  const lead = await createLeadForContact({
    organizationId: session.organizationId,
    contactId: inserted[0].id,
    stageId: body.data.stageId,
    source: "dueno",
    actorUserId: session.userId,
  });
  if (!lead) {
    return apiError(
      422,
      "no_stage",
      "El tablero no tiene etapas abiertas donde colocar al prospecto"
    );
  }

  // 020: quien no reparte (asesor) y captura a alguien a mano se lo queda —
  // si no, lo daría de alta y dejaría de verlo en el mismo instante.
  let contact = inserted[0];
  if (!session.access.seesAll) {
    await assignContacts({
      organizationId: session.organizationId,
      contactIds: [contact.id],
      toUserId: session.userId,
      actorUserId: session.userId,
      source: "manual",
      reason: "Alta manual",
    });
    contact = { ...contact, assignedUserId: session.userId, assignedAt: new Date() };
  }

  return Response.json(
    { contact: serializeContact(contact), lead: { id: lead.id } },
    { status: 201 }
  );
});
