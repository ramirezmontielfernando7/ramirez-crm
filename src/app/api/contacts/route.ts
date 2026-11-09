import { count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scopedContacts, type Access } from "@/lib/db/tenant";
import { normalizeMx } from "@/lib/meta/client";
import { stripPhoneAdornments } from "@/lib/phone-search";
import { createContactWithLead, serializeContact } from "@/server/contacts";
import {
  contactFilterConditions,
  contactSearchCondition,
  filterFromSearchParams,
} from "@/server/contact-filter";
import { tagsForContacts } from "@/server/tags/tags";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const stage = url.searchParams.get("stage")?.trim();
  const includeArchived = url.searchParams.get("archived") === "true";
  // Paginación real: `page` (desde 1) y `pageSize` (máx. 200). Antes se cortaba
  // en 200 ANTES de quitar los archivados, así que la lista podía mostrar menos
  // de los que había y nunca dejaba ver del 201 en adelante.
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));
  const pageSize = Math.min(
    200,
    Math.max(1, Math.floor(Number(url.searchParams.get("pageSize")) || 100))
  );
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
  if (stageContactIds?.length === 0)
    return Response.json({ contacts: [], total: 0, page, pageSize });

  // Los archivados se quitan EN la consulta, antes del corte de la página.
  // Mismas condiciones para la página y para el total (cada consulta lleva su
  // scopedContacts() a la vista: lo vigila tenant-query-guard).
  const conditions = [
    search,
    stageContactIds ? inArray(schema.contact.id, stageContactIds) : undefined,
    includeArchived ? undefined : isNull(schema.contact.archivedAt),
    ...contactFilterConditions(filter),
  ];

  const [rows, totals] = await Promise.all([
    db
      .select({
        contact: schema.contact,
        // Quién lo atiende y cuándo fue el último mensaje del chat de la
        // EMPRESA (los de «Mi número» no cuentan): columnas «Asesor» y
        // «Último mensaje» de la tabla. Columnas con su tabla escrita a mano:
        // dentro de un select de una sola tabla, Drizzle las pinta sin
        // calificar y `"id"` se resolvería contra `cv`.
        assigneeName: sql<string | null>`(
          select u."name" from "user" u where u."id" = "contact"."assigned_user_id"
        )`,
        lastMessageAt: sql<string | Date | null>`(
          select max(cv."last_message_at") from "conversation" cv
          where cv."contact_id" = "contact"."id"
            and cv."organization_id" = "contact"."organization_id"
            and cv."direct_number_id" is null
            and cv."is_test" = false
        )`,
      })
      .from(schema.contact)
      .where(
        scopedContacts(schema.contact.organizationId, session.access, schema.contact.id, ...conditions)
      )
      .orderBy(desc(schema.contact.updatedAt), desc(schema.contact.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ n: count() })
      .from(schema.contact)
      .where(
        scopedContacts(schema.contact.organizationId, session.access, schema.contact.id, ...conditions)
      ),
  ]);
  const total = Number(totals[0]?.n ?? 0);

  const visible = rows.map((r) => r.contact);
  const extraById = new Map(rows.map((r) => [r.contact.id, r]));
  const tagsByContact = await tagsForContacts(
    session.organizationId,
    visible.map((c) => c.id)
  );
  const contacts = visible.map((c) => {
    const extra = extraById.get(c.id);
    const last = extra?.lastMessageAt ?? null;
    return {
      ...serializeContact(
        c,
        stageByContact.get(c.id) ?? null,
        priorityByContact.get(c.id) ?? null,
        false,
        tagsByContact.get(c.id) ?? []
      ),
      assignee: c.assignedUserId
        ? { id: c.assignedUserId, name: extra?.assigneeName ?? "" }
        : null,
      lastMessageAt: last ? new Date(last).toISOString() : null,
    };
  });
  return Response.json({ contacts, total, page, pageSize });
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
    // Espacios, guiones, paréntesis y «+» se aceptan y se quitan al guardar.
    .transform(stripPhoneAdornments)
    .pipe(z.string().regex(/^\d{7,15}$/, "Teléfono en dígitos, con código de país (ej. 5215512345678)")),
  notes: z.string().max(4000).optional(),
  source: z.enum(["anuncio", "organico", "referido", "conocido", "otro"]).optional(),
  /** Etapa inicial del lead; si no viene, la primera abierta del tablero. */
  stageId: z.string().min(1).optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  // 003: la identidad WhatsApp se deriva del teléfono normalizado.
  const phone = normalizeMx(body.data.phone);
  const created = await createContactWithLead({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    seesAll: session.access.seesAll,
    name: body.data.name,
    phone,
    notes: body.data.notes,
    source: body.data.source,
    stageId: body.data.stageId,
  });
  if (!created.ok) {
    if (created.reason === "no_stage") {
      return apiError(
        422,
        "no_stage",
        "El tablero no tiene etapas abiertas donde colocar al prospecto"
      );
    }
    if (created.reason === "assignee_not_member") {
      return apiError(422, "invalid", DUPLICADO_GENERICO);
    }
    return respuestaDeDuplicado(session.access, phone);
  }
  const { contact, leadId } = created;

  return Response.json(
    { contact: serializeContact(contact), lead: { id: leadId } },
    { status: 201 }
  );
});
