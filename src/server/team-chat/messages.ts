import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import type { SessionContext } from "@/lib/auth/session";
import {
  attachmentRejection,
  isInlineImage,
  isReactionEmoji,
  TEAM_MESSAGE_MAX,
  TEAM_PAGE_DEFAULT,
  TEAM_PAGE_MAX,
  type TeamMessageDto,
  type TeamReactionDto,
} from "@/lib/team-chat";
import { notFound, TeamChatError } from "./errors";
import { threadAccess, threadDir, type ThreadAccess } from "./threads";

/**
 * 025 — Mensajes del chat de equipo: la ÚNICA puerta que escribe
 * `team_chat_message`, `team_chat_reaction`, `team_chat_read_state` y
 * `team_chat_attachment`. Cada operación pasa primero por `threadAccess`
 * (404 si la persona no ve el hilo) y luego por lo que su relación permite
 * (la supervisión solo lee).
 */

type MessageRow = typeof schema.teamChatMessage.$inferSelect;
type AttachmentRow = typeof schema.teamChatAttachment.$inferSelect;

export type TeamFileInput = { data: Buffer; mimeType: string; fileName: string };

function cleanBody(raw: string): string {
  const body = raw.replace(/\r\n/g, "\n").trim();
  if (body.length > TEAM_MESSAGE_MAX) {
    throw new TeamChatError(422, "too_long", `El mensaje pasa de ${TEAM_MESSAGE_MAX} caracteres`);
  }
  return body;
}

function safeFileName(name: string): string {
  const base = path.basename(name).replace(/[^\w. ()-]/g, "_").slice(0, 120);
  return base || "archivo";
}

function serializeAttachment(a: AttachmentRow) {
  return {
    id: a.id,
    name: a.fileName,
    mime: a.mimeType,
    size: a.fileSize,
    url: `/api/team-chat/attachments/${a.id}`,
    inline: isInlineImage(a.mimeType),
  };
}

async function reactionsFor(
  session: SessionContext,
  messageIds: string[]
): Promise<Map<string, TeamReactionDto[]>> {
  const out = new Map<string, TeamReactionDto[]>();
  if (messageIds.length === 0) return out;
  const r = schema.teamChatReaction;
  const rows = await getDb()
    .select({
      messageId: r.messageId,
      emoji: r.emoji,
      count: sql<number>`count(*)::int`,
      mine: sql<boolean>`bool_or(${r.userId} = ${session.userId})`,
      first: sql<string>`min(${r.createdAt})`,
    })
    .from(r)
    .where(scoped(r.organizationId, session.organizationId, inArray(r.messageId, messageIds)))
    .groupBy(r.messageId, r.emoji)
    .orderBy(sql`min(${r.createdAt})`);
  for (const row of rows) {
    out.set(row.messageId, [
      ...(out.get(row.messageId) ?? []),
      { emoji: row.emoji, count: row.count, mine: row.mine },
    ]);
  }
  return out;
}

async function serialize(
  session: SessionContext,
  rows: { m: MessageRow; authorName: string | null; att: AttachmentRow | null }[]
): Promise<TeamMessageDto[]> {
  const reactions = await reactionsFor(
    session,
    rows.map((r) => r.m.id)
  );
  return rows.map(({ m, authorName, att }) => ({
    id: m.id,
    threadId: m.threadId,
    author: m.authorUserId ? { id: m.authorUserId, name: authorName ?? "Usuario" } : null,
    // Lo borrado no se lee más: ni texto ni archivo.
    body: m.deletedAt ? "" : m.body,
    attachment: m.deletedAt || !att ? null : serializeAttachment(att),
    reactions: m.deletedAt ? [] : (reactions.get(m.id) ?? []),
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    deleted: !!m.deletedAt,
    mine: m.authorUserId === session.userId,
  }));
}

function selectMessages() {
  return getDb()
    .select({ m: schema.teamChatMessage, authorName: schema.user.name, att: schema.teamChatAttachment })
    .from(schema.teamChatMessage)
    .leftJoin(schema.user, eq(schema.user.id, schema.teamChatMessage.authorUserId))
    .leftJoin(schema.teamChatAttachment, eq(schema.teamChatAttachment.id, schema.teamChatMessage.attachmentId));
}

export async function getMessageDto(session: SessionContext, messageId: string): Promise<TeamMessageDto> {
  const rows = await selectMessages()
    .where(scoped(schema.teamChatMessage.organizationId, session.organizationId, eq(schema.teamChatMessage.id, messageId)))
    .limit(1);
  const [dto] = await serialize(session, rows);
  if (!dto) throw notFound();
  return dto;
}

/**
 * Historial de un hilo, del más nuevo hacia atrás: `before` = id del mensaje
 * más viejo que ya tiene el cliente. Devuelve la página en orden cronológico.
 */
export async function listMessages(
  session: SessionContext,
  threadId: string,
  opts: { before?: string | null; limit?: number } = {}
): Promise<{ access: ThreadAccess; messages: TeamMessageDto[]; hasMore: boolean }> {
  const access = await threadAccess(session, threadId);
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? TEAM_PAGE_DEFAULT)), TEAM_PAGE_MAX);
  const m = schema.teamChatMessage;
  let cursor: { createdAt: Date; id: string } | null = null;
  if (opts.before) {
    const [row] = await getDb()
      .select({ createdAt: m.createdAt, id: m.id })
      .from(m)
      .where(scoped(m.organizationId, session.organizationId, eq(m.threadId, threadId), eq(m.id, opts.before)))
      .limit(1);
    // Un cursor que no es de este hilo no revela nada: 404 como el hilo ajeno.
    if (!row) throw notFound();
    cursor = row;
  }
  const rows = await selectMessages()
    .where(
      scoped(
        m.organizationId,
        session.organizationId,
        eq(m.threadId, threadId),
        cursor
          ? or(lt(m.createdAt, cursor.createdAt), and(eq(m.createdAt, cursor.createdAt), lt(m.id, cursor.id)))
          : undefined
      )
    )
    .orderBy(desc(m.createdAt), desc(m.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  return { access, messages: await serialize(session, page), hasMore };
}

async function saveAttachment(
  session: SessionContext,
  threadId: string,
  file: TeamFileInput
): Promise<AttachmentRow> {
  const rejection = attachmentRejection(file.mimeType, file.fileName, file.data.byteLength);
  if (rejection) {
    const code = /16 MB/.test(rejection) ? 413 : 415;
    throw new TeamChatError(code, code === 413 ? "too_large" : "unsupported_type", rejection);
  }
  const id = newId("teamChatAttachment");
  const dir = threadDir(session.organizationId, threadId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, id), file.data);
  return {
    id,
    organizationId: session.organizationId,
    threadId,
    uploadedByUserId: session.userId,
    mimeType: file.mimeType.toLowerCase(),
    fileName: safeFileName(file.fileName),
    fileSize: file.data.byteLength,
    storagePath: path.join("team-chat", session.organizationId, threadId, id),
    createdAt: new Date(),
  };
}

/** Publica un mensaje (texto, archivo o ambos). */
export async function postMessage(
  session: SessionContext,
  threadId: string,
  input: { body?: string; file?: TeamFileInput | null }
): Promise<{ access: ThreadAccess; message: TeamMessageDto }> {
  const access = await threadAccess(session, threadId);
  if (!access.canPost) {
    throw new TeamChatError(
      403,
      "forbidden",
      access.relation === "oversight"
        ? "Estás viendo esta conversación como supervisor: es de solo lectura"
        : "En este canal solo publican el Propietario y los Coordinadores"
    );
  }
  const body = cleanBody(input.body ?? "");
  if (!body && !input.file) {
    throw new TeamChatError(422, "invalid_body", "Escribe un mensaje o adjunta un archivo");
  }
  const attachment = input.file ? await saveAttachment(session, threadId, input.file) : null;
  const id = newId("teamChatMessage");
  const now = new Date();
  try {
    await getDb().transaction(async (tx) => {
      if (attachment) await tx.insert(schema.teamChatAttachment).values(attachment);
      await tx.insert(schema.teamChatMessage).values({
        id,
        organizationId: session.organizationId,
        threadId,
        authorUserId: session.userId,
        body,
        attachmentId: attachment?.id ?? null,
        createdAt: now,
      });
      await tx
        .update(schema.teamChatThread)
        .set({ lastMessageAt: now, updatedAt: now })
        .where(scoped(schema.teamChatThread.organizationId, session.organizationId, eq(schema.teamChatThread.id, threadId)));
      // Lo que uno escribe ya lo leyó.
      await upsertRead(tx, session, threadId, now);
    });
  } catch (err) {
    // Sin fila no hay adjunto: el archivo huérfano se va.
    if (attachment) await rm(path.join(getEnv().MEDIA_DIR, attachment.storagePath), { force: true });
    throw err;
  }
  return { access, message: await getMessageDto(session, id) };
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function upsertRead(
  db: Tx | ReturnType<typeof getDb>,
  session: SessionContext,
  threadId: string,
  at: Date
): Promise<void> {
  await db
    .insert(schema.teamChatReadState)
    .values({ organizationId: session.organizationId, threadId, userId: session.userId, lastReadAt: at })
    .onConflictDoUpdate({
      target: [schema.teamChatReadState.threadId, schema.teamChatReadState.userId],
      // Nunca hacia atrás: dos pestañas no desmarcan lo leído.
      set: { lastReadAt: sql`greatest(${schema.teamChatReadState.lastReadAt}, excluded.last_read_at)` },
    });
}

/**
 * Marca el hilo como leído hasta ahora. La supervisión NO cambia nada: no es
 * su conversación (devuelve false y no escribe).
 */
export async function markRead(session: SessionContext, threadId: string): Promise<boolean> {
  const access = await threadAccess(session, threadId);
  if (access.relation !== "member") return false;
  await upsertRead(getDb(), session, threadId, new Date());
  return true;
}

/** Un mensaje del hilo que la persona ve, o 404. */
async function messageInVisibleThread(
  session: SessionContext,
  messageId: string
): Promise<{ row: MessageRow; access: ThreadAccess }> {
  const [row] = await getDb()
    .select()
    .from(schema.teamChatMessage)
    .where(scoped(schema.teamChatMessage.organizationId, session.organizationId, eq(schema.teamChatMessage.id, messageId)))
    .limit(1);
  if (!row) throw notFound();
  const access = await threadAccess(session, row.threadId);
  return { row, access };
}

function assertAuthor(session: SessionContext, row: MessageRow, access: ThreadAccess) {
  // La supervisión nunca edita ni borra, aunque el Propietario fuera el autor
  // en otro momento: aquí solo cuenta participar y ser el autor.
  if (access.relation !== "member" || row.authorUserId !== session.userId) {
    throw new TeamChatError(403, "forbidden", "Solo quien escribió el mensaje puede cambiarlo");
  }
  if (row.deletedAt) throw new TeamChatError(409, "deleted", "Este mensaje ya fue eliminado");
}

export async function editMessage(
  session: SessionContext,
  messageId: string,
  rawBody: string
): Promise<{ access: ThreadAccess; message: TeamMessageDto }> {
  const { row, access } = await messageInVisibleThread(session, messageId);
  assertAuthor(session, row, access);
  const body = cleanBody(rawBody);
  if (!body && !row.attachmentId) {
    throw new TeamChatError(422, "invalid_body", "El mensaje no puede quedar vacío");
  }
  await getDb()
    .update(schema.teamChatMessage)
    .set({ body, editedAt: new Date() })
    .where(scoped(schema.teamChatMessage.organizationId, session.organizationId, eq(schema.teamChatMessage.id, messageId)));
  return { access, message: await getMessageDto(session, messageId) };
}

/**
 * Borrado SUAVE: la fila queda con `deleted_at` (el hilo muestra "Mensaje
 * eliminado"), el texto se vacía y el adjunto se borra del disco y de la BD.
 */
export async function deleteMessage(
  session: SessionContext,
  messageId: string
): Promise<{ access: ThreadAccess; message: TeamMessageDto }> {
  const { row, access } = await messageInVisibleThread(session, messageId);
  assertAuthor(session, row, access);
  const db = getDb();
  let storagePath: string | null = null;
  await db.transaction(async (tx) => {
    await tx
      .update(schema.teamChatMessage)
      .set({ body: "", attachmentId: null, deletedAt: new Date() })
      .where(scoped(schema.teamChatMessage.organizationId, session.organizationId, eq(schema.teamChatMessage.id, messageId)));
    await tx
      .delete(schema.teamChatReaction)
      .where(scoped(schema.teamChatReaction.organizationId, session.organizationId, eq(schema.teamChatReaction.messageId, messageId)));
    if (row.attachmentId) {
      const [att] = await tx
        .delete(schema.teamChatAttachment)
        .where(
          scoped(schema.teamChatAttachment.organizationId, session.organizationId, eq(schema.teamChatAttachment.id, row.attachmentId))
        )
        .returning({ storagePath: schema.teamChatAttachment.storagePath });
      storagePath = att?.storagePath ?? null;
    }
  });
  if (storagePath) await rm(path.join(getEnv().MEDIA_DIR, storagePath), { force: true });
  return { access, message: await getMessageDto(session, messageId) };
}

/** Pone o quita una reacción propia. */
export async function setReaction(
  session: SessionContext,
  messageId: string,
  emoji: string,
  on: boolean
): Promise<{ access: ThreadAccess; message: TeamMessageDto }> {
  if (!isReactionEmoji(emoji)) {
    throw new TeamChatError(422, "invalid_body", "La reacción debe ser un emoji");
  }
  const { row, access } = await messageInVisibleThread(session, messageId);
  if (!access.canReact) {
    throw new TeamChatError(403, "forbidden", "Estás viendo esta conversación como supervisor: es de solo lectura");
  }
  if (row.deletedAt) throw new TeamChatError(409, "deleted", "Este mensaje ya fue eliminado");
  const r = schema.teamChatReaction;
  if (on) {
    await getDb()
      .insert(r)
      .values({ organizationId: session.organizationId, messageId, userId: session.userId, emoji })
      .onConflictDoNothing();
  } else {
    await getDb()
      .delete(r)
      .where(
        scoped(r.organizationId, session.organizationId, eq(r.messageId, messageId), eq(r.userId, session.userId), eq(r.emoji, emoji))
      );
  }
  return { access, message: await getMessageDto(session, messageId) };
}

/** El archivo de un adjunto, solo para quien ve su hilo (404 si no). */
export async function readAttachment(
  session: SessionContext,
  attachmentId: string
): Promise<{ row: AttachmentRow; data: Buffer }> {
  const [row] = await getDb()
    .select()
    .from(schema.teamChatAttachment)
    .where(scoped(schema.teamChatAttachment.organizationId, session.organizationId, eq(schema.teamChatAttachment.id, attachmentId)))
    .limit(1);
  if (!row) throw notFound();
  await threadAccess(session, row.threadId);
  try {
    return { row, data: await readFile(path.join(getEnv().MEDIA_DIR, row.storagePath)) };
  } catch {
    throw new TeamChatError(404, "gone", "El archivo ya no está en el servidor");
  }
}
