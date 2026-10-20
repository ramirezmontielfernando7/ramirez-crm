import { and, count, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  scopedContacts,
  scopedConversations,
  type Access,
} from "@/lib/db/tenant";
import { isWindowOpen, windowRemainingMs } from "@/server/inbox/window";
import type { ConversationDto } from "@/lib/types";
import type { InboxView } from "@/lib/campaign-inbox";
import { isTagColor, type TagDto } from "@/lib/tags";
import { botLastSeenAt, EXTERNAL_SEEN_WINDOW_MS } from "@/server/bot/status";

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

/**
 * 041 — Nombre de la campaña del chat (la pendiente o la que respondió).
 * Subconsulta con la organización: el id no lleva FK (borrar la campaña no
 * toca el chat; la marca queda genérica).
 */
const campaignNameSql = sql<string | null>`(
  select k.name from campaign k
  where k.organization_id = ${schema.conversation.organizationId}
    and k.id = coalesce(${schema.conversation.campaignPendingId}, ${schema.conversation.campaignRepliedId})
)`;

/** 041: la principal sin los chats de campaña sin respuesta; «Campañas», solo ellos. */
function viewCondition(view: InboxView) {
  return view === "campaigns"
    ? isNotNull(schema.conversation.campaignPendingId)
    : isNull(schema.conversation.campaignPendingId);
}

/**
 * 041 — Cuántos chats esperan en «Campañas» (lo que la sesión puede ver,
 * con el mismo filtro de asignación), para el contador de la pestaña sin
 * bajar la lista.
 */
export async function countCampaignPending(
  access: Access,
  filter: AssignmentFilter = { kind: "all" }
): Promise<number> {
  const rows = await getDb()
    .select({ n: count() })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(
      scopedContacts(
        schema.conversation.organizationId,
        access,
        schema.conversation.contactId,
        eq(schema.conversation.isTest, false),
        viewCondition("campaigns"),
        access.seesAll ? assignmentCondition(access, filter) : undefined
      )
    );
  return rows[0]?.n ?? 0;
}

/**
 * Total de no leídos que ve la sesión: EXACTAMENTE la suma de `unreadCount`
 * de lo que devuelve `listConversations(access)` sin parámetros (Bandeja
 * principal: incluye archivados, deja fuera pruebas y chats de «Campañas»).
 * Mismo `scopedContacts` y mismos filtros, para que el globo del menú no tenga
 * que bajar la lista entera solo para sumar. Si cambias uno, cambia el otro:
 * `tests/db/bandeja-no-leidos.test.ts` compara los dos.
 */
export async function countUnread(access: Access): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`coalesce(sum(${schema.conversation.unreadCount}), 0)::int` })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(
      scopedContacts(
        schema.conversation.organizationId,
        access,
        schema.conversation.contactId,
        eq(schema.conversation.isTest, false),
        viewCondition("main")
      )
    );
  return rows[0]?.n ?? 0;
}

/**
 * Paso 2 (PR 2) — Solo ESTOS chats (por id de conversación o por contacto),
 * para refrescar la fila que un aviso en vivo cambió sin bajar la lista
 * entera. Pasa por la MISMA consulta, con el mismo `scopedContacts`, la misma
 * vista y el mismo filtro de asignación: una fila refrescada es idéntica a la
 * de la lista completa, y lo que la sesión ya no ve (archivado aparte,
 * eliminado, reasignado, pasado a «Campañas») simplemente no vuelve.
 */
export type ConversationSubset = { ids?: string[]; contactIds?: string[] };

function subsetCondition(only: ConversationSubset | undefined) {
  if (!only) return undefined;
  const parts = [
    only.ids?.length ? inArray(schema.conversation.id, only.ids) : undefined,
    only.contactIds?.length ? inArray(schema.conversation.contactId, only.contactIds) : undefined,
  ].filter((c) => c !== undefined);
  // Pedir «ninguno» no es pedir «todos».
  return parts.length ? or(...parts)! : sql`false`;
}

export async function listConversations(
  access: Access,
  since?: Date,
  filter: AssignmentFilter = { kind: "all" },
  view: InboxView = "main",
  only?: ConversationSubset
): Promise<ConversationDto[]> {
  const db = getDb();
  // La organización va explícita (no solo por RLS): así el índice
  // (organization_id, conversation_id, created_at) sirve aunque la consulta
  // corra con un rol sin RLS, y no se recorre `message` entero por fila.
  const previewSql = sql<string | null>`(
    select coalesce(m.text, m.type)
    from message m
    where m.organization_id = ${access.organizationId}
      and m.conversation_id = ${schema.conversation.id}
    order by m.created_at desc
    limit 1
  )`;

  // 034: lead, etapa, etiquetas y "¿hay bot?" viajan en LA MISMA consulta (y
  // por tanto con el mismo filtro de asignación del asesor), no en consultas
  // aparte que habría que proteger una por una. El lead y su etapa salen de
  // UNA búsqueda lateral por fila (antes eran cuatro subconsultas al mismo lead).
  const leadActual = db
    .select({
      leadId: schema.lead.id,
      stageId: schema.lead.stageId,
      stageName: schema.pipelineStage.name,
      stageColor: schema.pipelineStage.color,
    })
    .from(schema.lead)
    .leftJoin(
      schema.pipelineStage,
      and(
        eq(schema.pipelineStage.organizationId, schema.lead.organizationId),
        eq(schema.pipelineStage.id, schema.lead.stageId)
      )
    )
    // Con el mismo filtro de asignación que la fila (para quien ve todo no
    // agrega nada; al asesor solo se le evalúa en sus filas visibles).
    .where(scopedContacts(schema.lead.organizationId, access, schema.lead.contactId, eq(schema.lead.contactId, schema.contact.id)))
    .limit(1)
    .as("lead_actual");
  const tagsSql = sql<TagDto[] | null>`(
    select json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) order by t.name)
    from contact_tag_assignment a
    join contact_tag t on t.id = a.tag_id
    where a.contact_id = ${schema.contact.id}
      and t.system_origin is null
  )`;
  const agentOnSql = sql<boolean | null>`(
    select ap.enabled from agent_profile ap
    where ap.organization_id = ${schema.conversation.organizationId}
  )`;

  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
      preview: previewSql,
      stageName: leadActual.stageName,
      stageColor: leadActual.stageColor,
      leadId: leadActual.leadId,
      stageId: leadActual.stageId,
      tags: tagsSql,
      agentOn: agentOnSql,
      anuncio: anuncioDeLista,
      assigneeName: assigneeNameSql,
      campaignName: campaignNameSql,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .leftJoin(schema.adAttribution, anuncioDeLaConversacion)
    .leftJoinLateral(leadActual, sql`true`)
    .where(
      scopedContacts(
        schema.conversation.organizationId,
        access,
        schema.conversation.contactId,
        eq(schema.conversation.isTest, false),
        viewCondition(view),
        since ? gt(schema.conversation.updatedAt, since) : undefined,
        access.seesAll ? assignmentCondition(access, filter) : undefined,
        subsetCondition(only)
      )
    )
    .orderBy(desc(sql`coalesce(${schema.conversation.lastMessageAt}, ${schema.conversation.createdAt})`));

  // ¿Hay algo que conteste? El agente encendido, o un cerebro externo que se
  // asomó en las últimas 24 h (en memoria; no consulta su /health).
  const seen = botLastSeenAt(access.organizationId);
  const externalSeen = !!seen && Date.now() - seen.getTime() < EXTERNAL_SEEN_WINDOW_MS;

  return rows.map((r) =>
    serializeConversation(
      r.conversation,
      r.contact,
      r.preview,
      r.stageName,
      aAnuncioDeLista(r.anuncio),
      r.assigneeName,
      {
        leadId: r.leadId,
        stageId: r.stageId,
        stageColor: r.stageColor,
        tags: r.tags ?? [],
        aiAvailable: !!r.agentOn || externalSeen,
        campaignName: r.campaignName,
      }
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
      campaignName: campaignNameSql,
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
  assigneeName: string | null = null,
  extra: {
    leadId?: string | null;
    stageId?: string | null;
    stageColor?: string | null;
    tags?: ConversationDto["tags"];
    aiAvailable?: boolean;
    campaignName?: string | null;
  } = {}
): ConversationDto {
  return {
    id: c.id,
    channel: c.channel,
    contact: { id: contact.id, name: contact.name, phone: contact.phone },
    assignee: contact.assignedUserId
      ? { id: contact.assignedUserId, name: assigneeName ?? "" }
      : null,
    stageName,
    stageColor: isTagColor(extra.stageColor) ? extra.stageColor : null,
    leadId: extra.leadId ?? null,
    stageId: extra.stageId ?? null,
    tags: extra.tags ?? [],
    archivedAt: c.archivedAt?.toISOString() ?? null,
    aiAvailable: extra.aiAvailable ?? false,
    aiEnabled: c.aiEnabled,
    handoffAt: c.handoffAt?.toISOString() ?? null,
    handoffReason: c.handoffReason,
    lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    unreadCount: c.unreadCount,
    windowOpen: isWindowOpen(c.lastInboundAt),
    windowRemainingMs: windowRemainingMs(c.lastInboundAt),
    preview,
    anuncio,
    campaign: c.campaignPendingId
      ? { state: "pending", name: extra.campaignName ?? null }
      : c.campaignRepliedId
        ? { state: "replied", name: extra.campaignName ?? null }
        : null,
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
