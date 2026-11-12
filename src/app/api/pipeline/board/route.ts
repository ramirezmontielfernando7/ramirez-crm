import { and, asc, eq, lte, sql } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { companyChat, scoped, scopedContacts } from "@/lib/db/tenant";
import { getBranding } from "@/server/branding";
import { isTagColor } from "@/lib/tags";
import { tagsForContacts } from "@/server/tags/tags";

export const dynamic = "force-dynamic";

/** Tarjetas por columna en la primera carga y tamaño de cada «Mostrar más». */
export const BOARD_PAGE = 50;
const BOARD_MAX = 1000;

/**
 * Datos del kanban: etapas ordenadas + tarjetas con su contacto. Con miles de
 * prospectos NO se mandan todos: cada columna trae sus primeras `take`
 * tarjetas (50 por defecto) y los totales de TODA la columna vienen
 * calculados aparte (`totals`), así el encabezado nunca miente. Con
 * `?stageId=…&offset=N` devuelve solo la siguiente página de esa columna.
 */
export const GET = withAuth(async (session, req: Request) => {
  const db = getDb();
  const url = new URL(req.url);
  const takeParam = Number(url.searchParams.get("take"));
  const take = Number.isInteger(takeParam) && takeParam > 0 ? Math.min(takeParam, BOARD_MAX) : BOARD_PAGE;
  const onlyStage = url.searchParams.get("stageId");
  const offsetParam = Number(url.searchParams.get("offset"));
  const offset = onlyStage && Number.isInteger(offsetParam) && offsetParam > 0 ? offsetParam : 0;
  const visible = scopedContacts(schema.lead.organizationId, session.access, schema.lead.contactId);
  // Posición de cada tarjeta dentro de su columna (en el orden del tablero).
  const ranked = db
    .select({
      id: schema.lead.id,
      rn: sql<number>`row_number() over (partition by ${schema.lead.stageId} order by ${schema.lead.position} asc, ${schema.lead.id} asc)`.as("rn"),
    })
    .from(schema.lead)
    .where(onlyStage ? and(visible, eq(schema.lead.stageId, onlyStage)) : visible)
    .as("ranked");

  const stages = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, session.organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const leads = await db
    .select({
      lead: schema.lead,
      contact: schema.contact,
      conversationId: schema.conversation.id,
      assigneeName: sql<string | null>`(
        select u."name" from "user" u where u."id" = ${schema.contact.assignedUserId}
      )`,
    })
    .from(schema.lead)
    .innerJoin(ranked, eq(ranked.id, schema.lead.id))
    .innerJoin(schema.contact, eq(schema.lead.contactId, schema.contact.id))
    .leftJoin(
      schema.conversation,
      and(
        eq(schema.conversation.contactId, schema.contact.id),
        companyChat()
      )
    )
    // 020: el asesor ve SOLO sus tarjetas; las etapas son de todos.
    .where(and(visible, sql`${ranked.rn} > ${offset}`, lte(ranked.rn, offset + take)))
    .orderBy(asc(schema.lead.position), asc(schema.lead.id));

  // La moneda del negocio viaja con el tablero: el cliente suma sus columnas y
  // necesita saber cuál es la única sumable, sin adivinarla ni pedirla aparte.
  const { currency } = await getBranding(session.organizationId);
  // Totales de TODA cada columna (no solo de las tarjetas que viajan).
  const sums = await db
    .select({
      stageId: schema.lead.stageId,
      n: sql<number>`count(*)::int`,
      sinMonto: sql<number>`(count(*) filter (where ${schema.lead.amountCents} is null))::int`,
      otraMoneda: sql<number>`(count(*) filter (where ${schema.lead.amountCents} is not null and coalesce(${schema.lead.currency}, ${currency}) <> ${currency}))::int`,
      totalCents: sql<number>`coalesce(sum(${schema.lead.amountCents}) filter (where ${schema.lead.amountCents} is not null and coalesce(${schema.lead.currency}, ${currency}) = ${currency}), 0)::float8`,
    })
    .from(schema.lead)
    .where(visible)
    .groupBy(schema.lead.stageId);
  // Etiquetas de cada tarjeta (ronda 3): una sola consulta para todo el tablero.
  const tagsByContact = await tagsForContacts(
    session.organizationId,
    leads.map((r) => r.contact.id)
  );

  return Response.json({
    currency,
    totals: Object.fromEntries(
      sums.map((r) => [r.stageId, { count: r.n, sinMonto: r.sinMonto, otraMoneda: r.otraMoneda, totalCents: r.totalCents }])
    ),
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      kind: s.kind,
      color: isTagColor(s.color) ? s.color : null,
    })),
    leads: leads.map((r) => ({
      id: r.lead.id,
      stageId: r.lead.stageId,
      position: r.lead.position,
      lastActivityAt: r.lead.lastActivityAt?.toISOString() ?? null,
      amountCents: r.lead.amountCents,
      currency: r.lead.currency,
      priority: r.lead.priority,
      contact: {
        id: r.contact.id,
        name: r.contact.name,
        phone: r.contact.phone,
      },
      conversationId: r.conversationId,
      tags: (tagsByContact.get(r.contact.id) ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
      })),
      assignee: r.contact.assignedUserId
        ? { id: r.contact.assignedUserId, name: r.assigneeName ?? "" }
        : null,
    })),
  });
});
