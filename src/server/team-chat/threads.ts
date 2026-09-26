import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import { can } from "@/lib/auth/permissions";
import type { SessionContext } from "@/lib/auth/session";
import {
  canPost,
  canReact,
  directKey,
  resolveRelation,
  TEAM_GROUP_NAME_MAX,
  type TeamChatListResponse,
  type TeamPersonDto,
  type TeamThreadDto,
  type ThreadRelation,
} from "@/lib/team-chat";
import { getTeamChatSettings, oversightNoticeVisible } from "./settings";
import { currentMemberIds, listPeople } from "./people";
import { isUniqueViolation, notFound, TeamChatError } from "./errors";
import { publishTeam } from "./audience";

/**
 * 025 — Hilos del chat de equipo: la ÚNICA puerta que lee y escribe
 * `team_chat_thread` y `team_chat_member`.
 *
 * Quién ve un hilo NO depende de `scope.all` (el Coordinador no ve directos
 * ajenos): participa o no participa. La excepción es la supervisión del
 * Propietario (`team_chat.oversee` + el ajuste encendido), en solo lectura.
 */

export type ThreadRow = typeof schema.teamChatThread.$inferSelect;

export type ThreadAccess = {
  thread: ThreadRow;
  relation: ThreadRelation;
  canPost: boolean;
  canReact: boolean;
};

/** Id determinista del canal de avisos (el mismo que siembra la migración 0020). */
export function announcementsIdFor(organizationId: string): string {
  return `tct_avisos_${createHash("md5").update(organizationId).digest("hex").slice(0, 16)}`;
}

/** El canal de avisos existe siempre: las organizaciones nuevas lo crean al primer uso. */
export async function ensureAnnouncements(organizationId: string): Promise<void> {
  await getDb()
    .insert(schema.teamChatThread)
    .values({
      id: announcementsIdFor(organizationId),
      organizationId,
      kind: "announcements",
      name: "Avisos",
    })
    .onConflictDoNothing();
}

async function overseeing(session: SessionContext): Promise<boolean> {
  if (!can(session, "team_chat.oversee")) return false;
  return (await getTeamChatSettings(session.organizationId)).ownerOversight;
}

/**
 * Carga un hilo y cómo se relaciona la persona con él. Si no lo ve: 404
 * (igual que si no existiera), nunca 403.
 */
export async function threadAccess(
  session: SessionContext,
  threadId: string
): Promise<ThreadAccess> {
  const db = getDb();
  const [thread] = await db
    .select()
    .from(schema.teamChatThread)
    .where(scoped(schema.teamChatThread.organizationId, session.organizationId, eq(schema.teamChatThread.id, threadId)))
    .limit(1);
  if (!thread) throw notFound();
  let isParticipant = thread.kind === "announcements";
  if (!isParticipant) {
    const rows = await db
      .select({ userId: schema.teamChatMember.userId })
      .from(schema.teamChatMember)
      .where(
        scoped(
          schema.teamChatMember.organizationId,
          session.organizationId,
          eq(schema.teamChatMember.threadId, thread.id),
          eq(schema.teamChatMember.userId, session.userId)
        )
      )
      .limit(1);
    isParticipant = rows.length > 0;
  }
  const relation = resolveRelation({
    kind: thread.kind,
    isParticipant,
    canOversee: can(session, "team_chat.oversee"),
    oversightOn: isParticipant ? false : await overseeing(session),
  });
  if (!relation) throw notFound();
  return {
    thread,
    relation,
    canPost: canPost(relation, thread.kind, can(session, "team_chat.announce")),
    canReact: canReact(relation),
  };
}

/** Participantes (explícitos) de un hilo, con nombre. Avisos: ninguno explícito. */
export async function threadMembers(
  organizationId: string,
  threadIds: string[]
): Promise<Map<string, TeamPersonDto[]>> {
  const out = new Map<string, TeamPersonDto[]>();
  if (threadIds.length === 0) return out;
  const people = new Map((await listPeople(organizationId)).map((p) => [p.id, p]));
  const rows = await getDb()
    .select({ threadId: schema.teamChatMember.threadId, userId: schema.teamChatMember.userId })
    .from(schema.teamChatMember)
    .where(scoped(schema.teamChatMember.organizationId, organizationId, inArray(schema.teamChatMember.threadId, threadIds)));
  for (const r of rows) {
    // Quien ya no es de la organización no se lista (ni cuenta).
    const person = people.get(r.userId);
    if (!person) continue;
    out.set(r.threadId, [...(out.get(r.threadId) ?? []), person]);
  }
  return out;
}

/**
 * No leídos por hilo para esta persona: mensajes de OTROS, no borrados,
 * posteriores a lo último que leyó (sin marca = todo).
 */
async function unreadByThread(
  session: SessionContext,
  threadIds: string[]
): Promise<Map<string, number>> {
  if (threadIds.length === 0) return new Map();
  const m = schema.teamChatMessage;
  const r = schema.teamChatReadState;
  const rows = await getDb()
    .select({ threadId: m.threadId, n: sql<number>`count(*)::int` })
    .from(m)
    .leftJoin(r, and(eq(r.threadId, m.threadId), eq(r.userId, session.userId)))
    .where(
      scoped(
        m.organizationId,
        session.organizationId,
        inArray(m.threadId, threadIds),
        isNull(m.deletedAt),
        or(isNull(m.authorUserId), ne(m.authorUserId, session.userId)),
        or(isNull(r.lastReadAt), sql`${m.createdAt} > ${r.lastReadAt}`)
      )
    )
    .groupBy(m.threadId);
  return new Map(rows.map((row) => [row.threadId, row.n]));
}

/** El último mensaje de cada hilo, para la vista previa de la lista. */
async function lastPreviews(
  organizationId: string,
  threadIds: string[]
): Promise<Map<string, string>> {
  if (threadIds.length === 0) return new Map();
  const m = schema.teamChatMessage;
  const rows = await getDb()
    .selectDistinctOn([m.threadId], {
      threadId: m.threadId,
      body: m.body,
      deletedAt: m.deletedAt,
      fileName: schema.teamChatAttachment.fileName,
    })
    .from(m)
    .leftJoin(schema.teamChatAttachment, eq(schema.teamChatAttachment.id, m.attachmentId))
    .where(scoped(m.organizationId, organizationId, inArray(m.threadId, threadIds)))
    .orderBy(m.threadId, desc(m.createdAt), desc(m.id));
  return new Map(
    rows.map((row) => [
      row.threadId,
      row.deletedAt
        ? "Mensaje eliminado"
        : row.body.trim()
          ? row.body.trim().slice(0, 140)
          : row.fileName
            ? `📎 ${row.fileName}`
            : "",
    ])
  );
}

/** La lista del chat de equipo de esta persona (y, si supervisa, los ajenos). */
export async function listThreads(session: SessionContext): Promise<TeamChatListResponse> {
  const { organizationId, userId } = session;
  await ensureAnnouncements(organizationId);
  const db = getDb();
  const settings = await getTeamChatSettings(organizationId);
  const oversee = can(session, "team_chat.oversee") && settings.ownerOversight;

  const mine = await db
    .select({ threadId: schema.teamChatMember.threadId })
    .from(schema.teamChatMember)
    .where(scoped(schema.teamChatMember.organizationId, organizationId, eq(schema.teamChatMember.userId, userId)));
  const mineIds = new Set(mine.map((r) => r.threadId));

  const t = schema.teamChatThread;
  const threads = await db
    .select()
    .from(t)
    .where(
      scoped(
        t.organizationId,
        organizationId,
        oversee
          ? undefined
          : or(eq(t.kind, "announcements"), mineIds.size ? inArray(t.id, [...mineIds]) : sql`false`)
      )
    );

  const ids = threads.map((th) => th.id);
  const participantIds = threads
    .filter((th) => th.kind === "announcements" || mineIds.has(th.id))
    .map((th) => th.id);
  const [members, unread, previews] = await Promise.all([
    threadMembers(organizationId, ids),
    unreadByThread(session, participantIds),
    lastPreviews(organizationId, ids),
  ]);
  const canAnnounce = can(session, "team_chat.announce");

  const dtos: TeamThreadDto[] = threads.map((th) => {
    const relation: ThreadRelation =
      th.kind === "announcements" || mineIds.has(th.id) ? "member" : "oversight";
    const people = members.get(th.id) ?? [];
    const title =
      th.kind === "direct"
        ? relation === "member"
          ? (people.find((p) => p.id !== userId)?.name ?? "Usuario eliminado")
          : people.map((p) => p.name).join(" · ") || "Directo"
        : (th.name ?? "Grupo");
    return {
      id: th.id,
      kind: th.kind,
      title,
      relation,
      canPost: canPost(relation, th.kind, canAnnounce),
      members: people,
      // La supervisión no suma: no es una conversación suya.
      unread: relation === "member" ? (unread.get(th.id) ?? 0) : 0,
      lastMessageAt: th.lastMessageAt?.toISOString() ?? null,
      lastMessagePreview: previews.get(th.id) ?? null,
    };
  });
  // Avisos arriba; luego lo propio por actividad; al final lo supervisado.
  const rank = (d: TeamThreadDto) => (d.kind === "announcements" ? 0 : d.relation === "member" ? 1 : 2);
  dtos.sort(
    (a, b) =>
      rank(a) - rank(b) || (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "")
  );
  return {
    threads: dtos,
    overseeing: oversee,
    // El aviso es para los DEMÁS: quien supervisa ya lo sabe.
    oversightNotice: oversightNoticeVisible(settings) && !can(session, "team_chat.oversee"),
    canCreateGroups: can(session, "team_chat.create_groups"),
  };
}

/** Total de no leídos (solo hilos donde participa): el badge del menú. */
export async function unreadTotal(session: SessionContext): Promise<number> {
  const { organizationId, userId } = session;
  const m = schema.teamChatMessage;
  const r = schema.teamChatReadState;
  const t = schema.teamChatThread;
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(m)
    .innerJoin(t, eq(t.id, m.threadId))
    .leftJoin(r, and(eq(r.threadId, m.threadId), eq(r.userId, userId)))
    .where(
      scoped(
        m.organizationId,
        organizationId,
        isNull(m.deletedAt),
        or(isNull(m.authorUserId), ne(m.authorUserId, userId)),
        or(isNull(r.lastReadAt), sql`${m.createdAt} > ${r.lastReadAt}`),
        or(
          eq(t.kind, "announcements"),
          sql`exists (select 1 from ${schema.teamChatMember} tm where tm.thread_id = ${m.threadId} and tm.user_id = ${userId})`
        )
      )
    );
  return row?.n ?? 0;
}

/** Abre (o reutiliza) el directo con otra persona de la organización. */
export async function openDirect(session: SessionContext, otherUserId: string): Promise<string> {
  const { organizationId, userId } = session;
  if (otherUserId === userId) {
    throw new TeamChatError(422, "invalid_body", "No puedes abrir un directo contigo");
  }
  // Una persona de OTRA organización es, para esta, inexistente: 404.
  if (!(await currentMemberIds(organizationId, [otherUserId])).has(otherUserId)) throw notFound();
  const key = directKey(userId, otherUserId);
  const find = async () => {
    const [row] = await getDb()
      .select({ id: schema.teamChatThread.id })
      .from(schema.teamChatThread)
      .where(scoped(schema.teamChatThread.organizationId, organizationId, eq(schema.teamChatThread.directKey, key)))
      .limit(1);
    return row?.id ?? null;
  };
  const existing = await find();
  if (existing) return existing;
  const id = newId("teamChatThread");
  try {
    await getDb().transaction(async (tx) => {
      await tx.insert(schema.teamChatThread).values({
        id,
        organizationId,
        kind: "direct",
        directKey: key,
        createdByUserId: userId,
      });
      await tx.insert(schema.teamChatMember).values([
        { organizationId, threadId: id, userId, addedByUserId: userId },
        { organizationId, threadId: id, userId: otherUserId, addedByUserId: userId },
      ]);
    });
    await publishTeam(organizationId, { id, kind: "direct" }, {
      type: "team.thread",
      data: { threadId: id, change: "created" },
    });
    return id;
  } catch (err) {
    // Dos personas lo abrieron a la vez: gana el primero, el otro lo reutiliza.
    if (isUniqueViolation(err)) {
      const again = await find();
      if (again) return again;
    }
    throw err;
  }
}

function cleanGroupName(name: string): string {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) throw new TeamChatError(422, "invalid_body", "El grupo necesita un nombre");
  if (clean.length > TEAM_GROUP_NAME_MAX) {
    throw new TeamChatError(422, "invalid_body", `El nombre pasa de ${TEAM_GROUP_NAME_MAX} caracteres`);
  }
  return clean;
}

async function validMembers(organizationId: string, ids: readonly string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  const current = await currentMemberIds(organizationId, unique);
  const unknown = unique.filter((id) => !current.has(id));
  if (unknown.length) {
    throw new TeamChatError(422, "invalid_body", "Hay participantes que no son del equipo");
  }
  return unique;
}

/** Todos los grupos de la organización con sus participantes (para administrarlos en Ajustes). */
export async function listGroups(
  organizationId: string
): Promise<{ id: string; name: string; members: TeamPersonDto[] }[]> {
  const rows = await getDb()
    .select({ id: schema.teamChatThread.id, name: schema.teamChatThread.name })
    .from(schema.teamChatThread)
    .where(scoped(schema.teamChatThread.organizationId, organizationId, eq(schema.teamChatThread.kind, "group")))
    .orderBy(schema.teamChatThread.name);
  const members = await threadMembers(
    organizationId,
    rows.map((r) => r.id)
  );
  return rows.map((r) => ({ id: r.id, name: r.name ?? "Grupo", members: members.get(r.id) ?? [] }));
}

/** Crea un grupo (quien lo crea queda dentro). Permiso: `team_chat.create_groups`. */
export async function createGroup(
  session: SessionContext,
  input: { name: string; memberIds: string[] }
): Promise<{ id: string; memberIds: string[] }> {
  const { organizationId, userId } = session;
  const name = cleanGroupName(input.name);
  const memberIds = await validMembers(organizationId, [userId, ...input.memberIds]);
  const id = newId("teamChatThread");
  await getDb().transaction(async (tx) => {
    await tx.insert(schema.teamChatThread).values({
      id,
      organizationId,
      kind: "group",
      name,
      createdByUserId: userId,
    });
    await tx.insert(schema.teamChatMember).values(
      memberIds.map((m) => ({ organizationId, threadId: id, userId: m, addedByUserId: userId }))
    );
  });
  await publishTeam(organizationId, { id, kind: "group" }, {
    type: "team.thread",
    data: { threadId: id, change: "created" },
  });
  return { id, memberIds };
}

async function groupOrNotFound(organizationId: string, id: string): Promise<ThreadRow> {
  const [row] = await getDb()
    .select()
    .from(schema.teamChatThread)
    .where(
      scoped(
        schema.teamChatThread.organizationId,
        organizationId,
        eq(schema.teamChatThread.id, id),
        eq(schema.teamChatThread.kind, "group")
      )
    )
    .limit(1);
  if (!row) throw notFound();
  return row;
}

/**
 * Renombra un grupo y/o reemplaza sus participantes. Devuelve quién entró y
 * quién salió (para avisarles en tiempo real).
 */
export async function updateGroup(
  session: SessionContext,
  id: string,
  input: { name?: string; memberIds?: string[] }
): Promise<{ added: string[]; removed: string[]; memberIds: string[] }> {
  const { organizationId, userId } = session;
  await groupOrNotFound(organizationId, id);
  const name = input.name === undefined ? undefined : cleanGroupName(input.name);
  const db = getDb();
  const before = (
    await db
      .select({ userId: schema.teamChatMember.userId })
      .from(schema.teamChatMember)
      .where(scoped(schema.teamChatMember.organizationId, organizationId, eq(schema.teamChatMember.threadId, id)))
  ).map((r) => r.userId);
  const next = input.memberIds ? await validMembers(organizationId, input.memberIds) : before;
  if (next.length === 0) {
    throw new TeamChatError(422, "invalid_body", "El grupo necesita al menos un participante");
  }
  const added = next.filter((m) => !before.includes(m));
  const removed = before.filter((m) => !next.includes(m));
  await db.transaction(async (tx) => {
    if (name !== undefined) {
      await tx
        .update(schema.teamChatThread)
        .set({ name, updatedAt: new Date() })
        .where(scoped(schema.teamChatThread.organizationId, organizationId, eq(schema.teamChatThread.id, id)));
    }
    if (removed.length) {
      await tx
        .delete(schema.teamChatMember)
        .where(
          scoped(
            schema.teamChatMember.organizationId,
            organizationId,
            eq(schema.teamChatMember.threadId, id),
            inArray(schema.teamChatMember.userId, removed)
          )
        );
    }
    if (added.length) {
      await tx
        .insert(schema.teamChatMember)
        .values(added.map((m) => ({ organizationId, threadId: id, userId: m, addedByUserId: userId })))
        .onConflictDoNothing();
    }
  });
  // Quien salió también se entera (para que el grupo deje su lista).
  await publishTeam(
    organizationId,
    { id, kind: "group" },
    { type: "team.thread", data: { threadId: id, change: "updated" } },
    removed
  );
  return { added, removed, memberIds: next };
}

/** Borra un grupo con sus mensajes y adjuntos (también del disco). */
export async function deleteGroup(
  session: SessionContext,
  id: string
): Promise<{ memberIds: string[] }> {
  const { organizationId } = session;
  await groupOrNotFound(organizationId, id);
  const db = getDb();
  const memberIds = (
    await db
      .select({ userId: schema.teamChatMember.userId })
      .from(schema.teamChatMember)
      .where(scoped(schema.teamChatMember.organizationId, organizationId, eq(schema.teamChatMember.threadId, id)))
  ).map((r) => r.userId);
  await db
    .delete(schema.teamChatThread)
    .where(scoped(schema.teamChatThread.organizationId, organizationId, eq(schema.teamChatThread.id, id)));
  // Los archivos viven en su carpeta por hilo: se va entera.
  await rm(threadDir(organizationId, id), { recursive: true, force: true });
  await publishTeam(
    organizationId,
    { id, kind: "group" },
    { type: "team.thread", data: { threadId: id, change: "deleted" } },
    memberIds
  );
  return { memberIds };
}

/** Carpeta de los adjuntos de un hilo dentro de MEDIA_DIR. */
export function threadDir(organizationId: string, threadId: string): string {
  for (const s of [organizationId, threadId]) {
    if (!/^[\w.-]+$/.test(s)) throw new Error("segmento de ruta inválido");
  }
  return path.join(getEnv().MEDIA_DIR, "team-chat", organizationId, threadId);
}
