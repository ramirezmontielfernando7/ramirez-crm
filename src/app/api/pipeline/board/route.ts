import { and, asc, eq, sql } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped, scopedContacts } from "@/lib/db/tenant";
import { getBranding } from "@/server/branding";

export const dynamic = "force-dynamic";

/** Datos completos del kanban: etapas ordenadas + tarjetas con su contacto. */
export const GET = withAuth(async (session) => {
  const db = getDb();

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
    .innerJoin(schema.contact, eq(schema.lead.contactId, schema.contact.id))
    .leftJoin(
      schema.conversation,
      and(
        eq(schema.conversation.contactId, schema.contact.id),
        eq(schema.conversation.isTest, false)
      )
    )
    // 020: el asesor ve SOLO sus tarjetas; las etapas son de todos.
    .where(
      scopedContacts(schema.lead.organizationId, session.access, schema.lead.contactId)
    )
    .orderBy(asc(schema.lead.position));

  // La moneda del negocio viaja con el tablero: el cliente suma sus columnas y
  // necesita saber cuál es la única sumable, sin adivinarla ni pedirla aparte.
  const { currency } = await getBranding(session.organizationId);

  return Response.json({
    currency,
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      kind: s.kind,
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
      assignee: r.contact.assignedUserId
        ? { id: r.contact.assignedUserId, name: r.assigneeName ?? "" }
        : null,
    })),
  });
});
