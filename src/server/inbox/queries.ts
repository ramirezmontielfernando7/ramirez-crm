import { and, count, desc, eq, gt, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
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
import { ALL_TAGS } from "@/lib/inbox-filters";
import type { InboxCounts, ListFilters, ListStatus } from "@/lib/inbox-list";
import { CHANNEL_ORDER } from "@/lib/channels";
import { digitsOnly, normalizeText } from "@/lib/search";
import { encodeCursor, type Cursor } from "@/server/inbox/cursor";

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

/**
 * Fluidez PR 3 — Los filtros de la pantalla, en el servidor. Cada uno es la
 * MISMA regla que `matchesListQuery` (src/lib/inbox-list.ts) aplica en el
 * navegador sobre lo ya cargado: si cambias uno, cambia el otro.
 */
export type ListOptions = {
  list?: ListFilters & { status: ListStatus };
  /** Sin `page`: la lista entera, como siempre (globo, menciones, guiones). */
  page?: { limit: number; cursor: Cursor | null };
};

/** La llave de orden de la lista (y de su índice, migración 0053). */
const sortKeySql = sql`coalesce(${schema.conversation.lastMessageAt}, ${schema.conversation.createdAt})`;

/**
 * Sin acentos ni mayúsculas, como `normalizeText` (src/lib/search.ts). Con
 * `translate` y no `unaccent`: no hace falta extensión y `lower` de un texto
 * ya sin acentos no depende del idioma de la BD.
 */
const ACENTOS = "ÁÀÄÂÃáàäâãÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÑñÇç";
const SIN_ACENTOS = "AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc";

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/** `matchesQuery`: nombre sin acentos, o (con 3+ dígitos) el teléfono por dígitos. */
function queryCondition(q: string) {
  const text = normalizeText(q.trim());
  if (!text) return undefined;
  const byName = sql`lower(translate(coalesce(${schema.contact.name}, ''), ${ACENTOS}, ${SIN_ACENTOS})) like ${`%${escapeLike(text)}%`}`;
  const digits = digitsOnly(q);
  if (digits.length < 3) return byName;
  const byPhone = sql`regexp_replace(coalesce(${schema.contact.phone}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`;
  return or(byName, byPhone)!;
}

/** Quién atiende, para quien ve todo (al asesor ya lo limita `scopedContacts`). */
function ownerCondition(access: Access, owner: string) {
  if (!access.seesAll || owner === "all") return undefined;
  if (owner === "mine") return assignmentCondition(access, { kind: "mine" });
  if (owner === "unassigned") return assignmentCondition(access, { kind: "unassigned" });
  return assignmentCondition(access, { kind: "user", userId: owner });
}

/** Lleva la etiqueta (solo las visibles: las de sistema no salen en la fila). */
function tagCondition(tag: string) {
  if (!tag || tag === ALL_TAGS) return undefined;
  return sql`exists (
    select 1 from contact_tag_assignment a
    join contact_tag t on t.id = a.tag_id
    where a.contact_id = ${schema.contact.id}
      and a.tag_id = ${tag}
      and t.system_origin is null
  )`;
}

const archivada = isNotNull(schema.conversation.archivedAt);
const aLaVista = isNull(schema.conversation.archivedAt);
const conAnuncio = isNotNull(schema.adAttribution.id);
const enAtencionHumana = isNotNull(schema.conversation.handoffAt);
const noLeida = gt(schema.conversation.unreadCount, 0);

function statusCondition(status: ListStatus) {
  switch (status) {
    case "all":
      return aLaVista;
    case "unread":
      return and(aLaVista, noLeida);
    case "archived":
      return archivada;
    case "humano":
      return and(aLaVista, enAtencionHumana);
    case "anuncios":
      return and(aLaVista, conAnuncio);
  }
}

/**
 * El lead del contacto y su etapa: UNA búsqueda lateral por fila (antes eran
 * cuatro subconsultas al mismo lead), con el mismo filtro de asignación que
 * la fila (para quien ve todo no agrega nada; al asesor solo se le evalúa en
 * sus filas visibles).
 */
function leadActualDe(access: Access) {
  return getDb()
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
    .where(scopedContacts(schema.lead.organizationId, access, schema.lead.contactId, eq(schema.lead.contactId, schema.contact.id)))
    .limit(1)
    .as("lead_actual");
}

/** Búsqueda, etapa, etiqueta y quién atiende (sin bandeja ni estado). */
function screenFilters(access: Access, f: ListFilters, stageName: unknown) {
  return [
    queryCondition(f.q),
    f.stage !== "all" ? sql`${stageName} = ${f.stage}` : undefined,
    tagCondition(f.tag),
    ownerCondition(access, f.owner),
  ];
}

export async function listConversations(
  access: Access,
  since?: Date,
  filter: AssignmentFilter = { kind: "all" },
  view: InboxView = "main",
  only?: ConversationSubset,
  options: ListOptions = {}
): Promise<ConversationDto[]> {
  return (await queryConversations(access, since, filter, view, only, options)).conversations;
}

/**
 * Fluidez PR 3 — Una página de la Bandeja con los filtros de la pantalla.
 * `nextCursor` null = no hay más.
 */
export async function listConversationsPage(
  access: Access,
  view: InboxView,
  list: ListFilters & { status: ListStatus },
  page: { limit: number; cursor: Cursor | null }
): Promise<{ conversations: ConversationDto[]; nextCursor: string | null }> {
  const { conversations, nextCursor } = await queryConversations(
    access,
    undefined,
    { kind: "all" },
    view,
    undefined,
    { list, page }
  );
  return { conversations, nextCursor };
}

async function queryConversations(
  access: Access,
  since: Date | undefined,
  filter: AssignmentFilter,
  view: InboxView,
  only: ConversationSubset | undefined,
  { list, page }: ListOptions
): Promise<{ conversations: ConversationDto[]; nextCursor: string | null }> {
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
  // aparte que habría que proteger una por una.
  const leadActual = leadActualDe(access);
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

  const listConditions = list
    ? [
        ...screenFilters(access, list, leadActual.stageName),
        list.channel !== "all" ? eq(schema.conversation.channel, list.channel) : undefined,
        view === "main" ? statusCondition(list.status) : undefined,
      ]
    : [];
  const cursor = page?.cursor;

  const query = db
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
      // Texto con microsegundos, para el cursor (ver src/server/inbox/cursor.ts).
      sortKey: sql<string>`to_char(${sortKeySql}, 'YYYY-MM-DD HH24:MI:SS.US')`,
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
        subsetCondition(only),
        ...listConditions,
        cursor
          ? sql`(${sortKeySql}, ${schema.conversation.id}) < (${cursor.key}::timestamp, ${cursor.id})`
          : undefined
      )
    )
    .orderBy(desc(sortKeySql), desc(schema.conversation.id));
  // Una fila de más: si llega, hay página siguiente.
  const rows = page ? await query.limit(page.limit + 1) : await query;
  const more = !!page && rows.length > page.limit;
  if (more) rows.length = page.limit;
  const last = rows[rows.length - 1];
  const nextCursor = more && last ? encodeCursor({ key: last.sortKey, id: last.conversation.id }) : null;

  // ¿Hay algo que conteste? El agente encendido, o un cerebro externo que se
  // asomó en las últimas 24 h (en memoria; no consulta su /health).
  const seen = botLastSeenAt(access.organizationId);
  const externalSeen = !!seen && Date.now() - seen.getTime() < EXTERNAL_SEEN_WINDOW_MS;

  const conversations = rows.map((r) =>
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
  return { conversations, nextCursor };
}

/**
 * Fluidez PR 3 — Los contadores de la Bandeja (`GET /api/conversations/counts`)
 * sin bajar la lista: cada cifra es EXACTAMENTE cuántas filas traería la lista
 * con ese filtro (mismas condiciones de arriba, mismo `scopedContacts`). Antes
 * los contaba el navegador sobre la lista completa; las reglas son las mismas
 * (ver el tipo `InboxCounts`).
 */
export async function countConversations(access: Access, f: ListFilters): Promise<InboxCounts> {
  const db = getDb();
  const leadActual = leadActualDe(access);
  const main = isNull(schema.conversation.campaignPendingId);
  const campaign = isNotNull(schema.conversation.campaignPendingId);
  const filtros = and(...screenFilters(access, f, leadActual.stageName)) ?? sql`true`;
  const enBandeja =
    f.channel !== "all" ? eq(schema.conversation.channel, f.channel) : sql`true`;
  const n = (cond: SQL | undefined) => sql<number>`(count(*) filter (where ${cond ?? sql`true`}))::int`;
  const q = queryCondition(f.q);
  const real = eq(schema.conversation.isTest, false);

  const enLaPrincipal = and(main, filtros, enBandeja);
  const [totals] = await db
    .select({
      total: n(main),
      all: n(and(enLaPrincipal, aLaVista)),
      unread: n(and(enLaPrincipal, aLaVista, noLeida)),
      archived: n(and(enLaPrincipal, archivada)),
      humano: n(and(enLaPrincipal, aLaVista, enAtencionHumana)),
      anuncios: n(and(enLaPrincipal, aLaVista, conAnuncio)),
      campaigns: n(and(campaign, filtros, enBandeja)),
      campaignPending: n(campaign),
      queryHits: n(q ? and(main, q) : sql`false`),
      ...Object.fromEntries(
        CHANNEL_ORDER.map((ch) => [
          `ch_${ch}`,
          n(and(main, filtros, aLaVista, eq(schema.conversation.channel, ch))),
        ])
      ),
    })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .leftJoin(schema.adAttribution, anuncioDeLaConversacion)
    .leftJoinLateral(leadActual, sql`true`)
    .where(scopedContacts(schema.conversation.organizationId, access, schema.conversation.contactId, real));

  // Lo que ofrecen los selectores: lo PRESENTE en la principal (con
  // archivados), sin los filtros de pantalla, como cuando se sacaba de la
  // lista completa. Las etapas, en el orden en que aparecían en ella.
  const stageRows = await db
    .select({ name: leadActual.stageName })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .leftJoinLateral(leadActual, sql`true`)
    .where(scopedContacts(schema.conversation.organizationId, access, schema.conversation.contactId, real, main, isNotNull(leadActual.stageName)))
    .groupBy(leadActual.stageName)
    .orderBy(desc(sql`max(${sortKeySql})`));
  const tagRows = await db
    .selectDistinct({ id: schema.contactTag.id, name: schema.contactTag.name })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .innerJoin(schema.contactTagAssignment, eq(schema.contactTagAssignment.contactId, schema.contact.id))
    .innerJoin(schema.contactTag, eq(schema.contactTag.id, schema.contactTagAssignment.tagId))
    .where(scopedContacts(schema.conversation.organizationId, access, schema.conversation.contactId, real, main, isNull(schema.contactTag.systemOrigin)));
  const ownerRows = await db
    .selectDistinct({ id: schema.contact.assignedUserId, name: assigneeNameSql })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(scopedContacts(schema.conversation.organizationId, access, schema.conversation.contactId, real, main, isNotNull(schema.contact.assignedUserId)));

  const t = (totals ?? {}) as Record<string, number | undefined>;
  const channels: InboxCounts["channels"] = {};
  for (const ch of CHANNEL_ORDER) channels[ch] = t[`ch_${ch}`] ?? 0;
  return {
    q: f.q,
    total: t.total ?? 0,
    all: t.all ?? 0,
    unread: t.unread ?? 0,
    archived: t.archived ?? 0,
    humano: t.humano ?? 0,
    anuncios: t.anuncios ?? 0,
    campaigns: t.campaigns ?? 0,
    campaignPending: t.campaignPending ?? 0,
    channels,
    queryHits: t.queryHits ?? 0,
    stages: stageRows.map((r) => r.name).filter((s): s is string => !!s),
    tags: tagRows.map((r) => [r.id, r.name]),
    owners: ownerRows.filter((r): r is { id: string; name: string | null } => !!r.id).map((r) => [r.id, r.name ?? ""]),
  };
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
