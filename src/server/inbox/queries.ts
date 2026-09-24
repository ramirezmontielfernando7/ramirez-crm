import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  scopedContacts,
  scopedConversations,
  type Access,
} from "@/lib/db/tenant";
import { isWindowOpen, windowRemainingMs } from "@/server/inbox/window";
import type { ConversationDto } from "@/lib/types";

/**
 * 018 — El anuncio de origen viaja con la conversación. La llave única
 * (organización, conversación) garantiza a lo más una fila por renglón, así
 * que el LEFT JOIN no multiplica la lista.
 */
const anuncioDeLaConversacion = and(
  eq(schema.adAttribution.organizationId, schema.conversation.organizationId),
  eq(schema.adAttribution.conversationId, schema.conversation.id)
);

const anuncioDeLista = {
  id: schema.adAttribution.id,
  headline: schema.adAttribution.headline,
  sourceId: schema.adAttribution.sourceId,
  sourceType: schema.adAttribution.sourceType,
};

function aAnuncioDeLista(
  fila: {
    id: string | null;
    headline: string | null;
    sourceId: string | null;
    sourceType: string | null;
  } | null
): ConversationDto["anuncio"] {
  // Sin fila, drizzle devuelve el objeto con todo en null (o null a secas).
  if (!fila?.id) return null;
  return {
    headline: fila.headline,
    sourceId: fila.sourceId,
    sourceType: fila.sourceType,
  };
}

/**
 * 020 — Nombre de quien atiende al contacto. Subconsulta y no JOIN: `user`
 * también es una tabla de better-auth y un segundo join a ella en la lista
 * complicaría los alias sin ahorrar nada (una fila por conversación).
 */
const assigneeNameSql = sql<string | null>`(
  select u."name" from "user" u where u."id" = ${schema.contact.assignedUserId}
)`;

/**
 * Filtro de asignación de la bandeja. Solo tiene efecto para quien ve todo:
 * a un asesor `scopedContacts` ya lo limita a lo suyo, diga lo que diga.
 */
export type AssignmentFilter =
  | { kind: "all" }
  | { kind: "mine" }
  | { kind: "unassigned" }
  | { kind: "user"; userId: string };

function assignmentCondition(access: Access, filter: AssignmentFilter) {
  switch (filter.kind) {
    case "all":
      return undefined;
    case "mine":
      return eq(schema.contact.assignedUserId, access.userId);
    case "unassigned":
      return isNull(schema.contact.assignedUserId);
    case "user":
      return eq(schema.contact.assignedUserId, filter.userId);
  }
}

export async function listConversations(
  access: Access,
  since?: Date,
  filter: AssignmentFilter = { kind: "all" }
): Promise<ConversationDto[]> {
  const db = getDb();
  const previewSql = sql<string | null>`(
    select coalesce(m.text, m.type)
    from message m
    where m.conversation_id = ${schema.conversation.id}
    order by m.created_at desc
    limit 1
  )`;
  const stageSql = sql<string | null>`(
    select s.name from lead l
    join pipeline_stage s on s.id = l.stage_id
    where l.contact_id = ${schema.contact.id}
    limit 1
  )`;

  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
      preview: previewSql,
      stageName: stageSql,
      anuncio: anuncioDeLista,
      assigneeName: assigneeNameSql,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .leftJoin(schema.adAttribution, anuncioDeLaConversacion)
    .where(
      scopedContacts(
        schema.conversation.organizationId,
        access,
        schema.conversation.contactId,
        eq(schema.conversation.isTest, false),
        since ? gt(schema.conversation.updatedAt, since) : undefined,
        access.seesAll ? assignmentCondition(access, filter) : undefined
      )
    )
    .orderBy(desc(sql`coalesce(${schema.conversation.lastMessageAt}, ${schema.conversation.createdAt})`));

  return rows.map((r) =>
    serializeConversation(
      r.conversation,
      r.contact,
      r.preview,
      r.stageName,
      aAnuncioDeLista(r.anuncio),
      r.assigneeName
    )
  );
}

/**
 * Una conversación, SOLO si la sesión puede verla (020). Para un asesor, la
 * de otro devuelve null igual que si no existiera: las rutas responden 404 y
 * no confirman que existe.
 */
export async function getConversation(access: Access, conversationId: string) {
  const db = getDb();
  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
      anuncio: anuncioDeLista,
      assigneeName: assigneeNameSql,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .leftJoin(schema.adAttribution, anuncioDeLaConversacion)
    .where(
      scopedContacts(
        schema.conversation.organizationId,
        access,
        schema.conversation.contactId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  const row = rows[0];
  return row ? { ...row, anuncio: aAnuncioDeLista(row.anuncio) } : null;
}

export async function listMessages(
  access: Access,
  conversationId: string,
  since?: Date
) {
  const db = getDb();
  return db
    .select({ message: schema.message, media: schema.mediaAsset })
    .from(schema.message)
    .leftJoin(
      schema.mediaAsset,
      eq(schema.message.mediaAssetId, schema.mediaAsset.id)
    )
    .where(
      scopedConversations(
        schema.message.organizationId,
        access,
        schema.message.conversationId,
        eq(schema.message.conversationId, conversationId),
        since ? gt(schema.message.createdAt, since) : undefined
      )
    )
    .orderBy(schema.message.createdAt);
}

export function serializeConversation(
  c: typeof schema.conversation.$inferSelect,
  contact: typeof schema.contact.$inferSelect,
  preview: string | null = null,
  stageName: string | null = null,
  anuncio: ConversationDto["anuncio"] = null,
  assigneeName: string | null = null
): ConversationDto {
  return {
    id: c.id,
    channel: c.channel,
    contact: { id: contact.id, name: contact.name, phone: contact.phone },
    assignee: contact.assignedUserId
      ? { id: contact.assignedUserId, name: assigneeName ?? "" }
      : null,
    stageName,
    aiEnabled: c.aiEnabled,
    handoffAt: c.handoffAt?.toISOString() ?? null,
    handoffReason: c.handoffReason,
    lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    unreadCount: c.unreadCount,
    windowOpen: isWindowOpen(c.lastInboundAt),
    windowRemainingMs: windowRemainingMs(c.lastInboundAt),
    preview,
    anuncio,
  };
}

/** Solo actualiza si la sesión puede ver la conversación (020). */
export async function updateConversation(
  access: Access,
  conversationId: string,
  patch: { aiEnabled?: boolean; reactivate?: boolean; markRead?: boolean }
) {
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.aiEnabled !== undefined) set.aiEnabled = patch.aiEnabled;
  if (patch.reactivate) {
    set.handoffAt = null;
    set.handoffReason = null;
    set.aiEnabled = patch.aiEnabled ?? true;
  }
  if (patch.markRead) set.unreadCount = 0;

  const updated = await db
    .update(schema.conversation)
    .set(set)
    .where(
      scopedContacts(
        schema.conversation.organizationId,
        access,
        schema.conversation.contactId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .returning();
  return updated[0] ?? null;
}
