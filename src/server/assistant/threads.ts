import { asc, desc, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import {
  HISTORY_EXCHANGES,
  THREAD_RETENTION_DAYS,
  threadTitle,
  type AssistantMessageDto,
  type AssistantMessageMeta,
  type AssistantThreadDto,
} from "@/lib/assistant-engine";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { HistoryEntry, LlmUsage } from "./engine";

/**
 * 038 (PR 2) — Las conversaciones del asistente (`assistant_thread` /
 * `assistant_message`, 0047 + 0048). ÚNICA puerta de esas tablas. Cada hilo
 * es de UNA persona: nadie más lo lista ni lo abre (ni otro Propietario).
 * Pool de la app → RLS de la organización, y `scoped()` en cada sentencia.
 *
 * Retención: los hilos sin actividad en `THREAD_RETENTION_DAYS` (90) días se
 * borran (con sus mensajes, en cascada) cada vez que su dueño lista o pregunta.
 */

function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - THREAD_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/** Borra los hilos viejos de esta persona. Devuelve cuántos. */
export async function purgeOldThreads(organizationId: string, userId: string, now = new Date()): Promise<number> {
  const rows = await getDb()
    .delete(schema.assistantThread)
    .where(
      scoped(
        schema.assistantThread.organizationId,
        organizationId,
        eq(schema.assistantThread.userId, userId),
        eq(schema.assistantThread.kind, "thread"),
        lt(schema.assistantThread.updatedAt, retentionCutoff(now))
      )
    )
    .returning({ id: schema.assistantThread.id });
  return rows.length;
}

type ThreadRow = { id: string; title: string | null; updatedAt: Date; kind: "general" | "thread"; archivedAt: Date | null };

function toDto(r: ThreadRow): AssistantThreadDto {
  return {
    id: r.id,
    title: r.kind === "general" ? "Asistente" : (r.title ?? "Conversación"),
    updatedAt: r.updatedAt.toISOString(),
    kind: r.kind,
    archived: r.archivedAt !== null,
  };
}

/**
 * Los hilos de esta persona (archivados incluidos, la pantalla los separa),
 * sin el Chat general, del más reciente al más viejo.
 */
export async function listThreads(organizationId: string, userId: string, now = new Date()): Promise<AssistantThreadDto[]> {
  await purgeOldThreads(organizationId, userId, now);
  const rows = await getDb()
    .select({
      id: schema.assistantThread.id,
      title: schema.assistantThread.title,
      updatedAt: schema.assistantThread.updatedAt,
      kind: schema.assistantThread.kind,
      archivedAt: schema.assistantThread.archivedAt,
    })
    .from(schema.assistantThread)
    .where(
      scoped(
        schema.assistantThread.organizationId,
        organizationId,
        eq(schema.assistantThread.userId, userId),
        eq(schema.assistantThread.kind, "thread")
      )
    )
    .orderBy(desc(schema.assistantThread.updatedAt))
    .limit(100);
  return rows.map(toDto);
}

/** El Chat general de esta persona: se crea la primera vez (uno por persona). */
export async function ensureGeneralThread(organizationId: string, userId: string, now = new Date()): Promise<AssistantThreadDto> {
  const find = () =>
    getDb()
      .select({
        id: schema.assistantThread.id,
        title: schema.assistantThread.title,
        updatedAt: schema.assistantThread.updatedAt,
        kind: schema.assistantThread.kind,
        archivedAt: schema.assistantThread.archivedAt,
      })
      .from(schema.assistantThread)
      .where(
        scoped(
          schema.assistantThread.organizationId,
          organizationId,
          eq(schema.assistantThread.userId, userId),
          eq(schema.assistantThread.kind, "general")
        )
      )
      .limit(1);
  const [existing] = await find();
  if (existing) return toDto(existing);
  await getDb()
    .insert(schema.assistantThread)
    .values({ id: newId("assistantThread"), organizationId, userId, kind: "general", title: "Asistente", createdAt: now, updatedAt: now })
    .onConflictDoNothing();
  const [row] = await find();
  if (!row) throw new Error("No se pudo crear el Chat general del asistente");
  return toDto(row);
}

/** ¿Es un hilo de esta persona en esta organización? */
async function ownsThread(organizationId: string, userId: string, threadId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.assistantThread.id })
    .from(schema.assistantThread)
    .where(
      scoped(
        schema.assistantThread.organizationId,
        organizationId,
        eq(schema.assistantThread.id, threadId),
        eq(schema.assistantThread.userId, userId)
      )
    )
    .limit(1);
  return !!row;
}

/** Los mensajes de un hilo; `null` si no existe o no es de esta persona. */
export async function getThreadMessages(
  organizationId: string,
  userId: string,
  threadId: string
): Promise<AssistantMessageDto[] | null> {
  if (!(await ownsThread(organizationId, userId, threadId))) return null;
  const rows = await getDb()
    .select({
      id: schema.assistantMessage.id,
      role: schema.assistantMessage.role,
      content: schema.assistantMessage.content,
      sources: schema.assistantMessage.sources,
      createdAt: schema.assistantMessage.createdAt,
    })
    .from(schema.assistantMessage)
    .where(scoped(schema.assistantMessage.organizationId, organizationId, eq(schema.assistantMessage.threadId, threadId)))
    .orderBy(asc(schema.assistantMessage.createdAt), asc(schema.assistantMessage.role));
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
    meta: (r.sources as AssistantMessageMeta | null) ?? null,
  }));
}

/**
 * Los últimos intercambios del hilo como los vio el modelo (enmascarados).
 * Un mensaje sin versión enmascarada (no debería haberlo) no se recuerda: es
 * preferible perder contexto que reabrir un dato real.
 */
export async function threadHistory(organizationId: string, userId: string, threadId: string): Promise<HistoryEntry[] | null> {
  if (!(await ownsThread(organizationId, userId, threadId))) return null;
  const rows = await getDb()
    .select({ role: schema.assistantMessage.role, masked: schema.assistantMessage.maskedContent, sources: schema.assistantMessage.sources })
    .from(schema.assistantMessage)
    .where(scoped(schema.assistantMessage.organizationId, organizationId, eq(schema.assistantMessage.threadId, threadId)))
    .orderBy(desc(schema.assistantMessage.createdAt), desc(schema.assistantMessage.role))
    .limit(HISTORY_EXCHANGES * 2);
  const ordered = rows.reverse();
  return ordered
    .map((r, i) => {
      // La pregunta usa las fichas de la respuesta que le sigue (se guardan juntas).
      const own = (r.sources as AssistantMessageMeta | null)?.masks;
      const next = ordered[i + 1];
      const masks = own ?? (r.role === "user" && next?.role === "assistant" ? (next.sources as AssistantMessageMeta | null)?.masks : undefined);
      return { role: r.role, masked: r.masked, masks };
    })
    .filter((r): r is { role: "user" | "assistant"; masked: string; masks: Record<string, string> | undefined } => !!r.masked)
    .map((r) => ({ role: r.role, maskedContent: r.masked, ...(r.masks ? { masks: r.masks } : {}) }));
}

export type SaveExchangeInput = {
  organizationId: string;
  userId: string;
  /** Hilo existente (de esta persona) o `null` para abrir uno nuevo. */
  threadId: string | null;
  question: string;
  maskedQuestion: string;
  answer: string;
  maskedAnswer: string;
  meta: AssistantMessageMeta;
  usage: LlmUsage;
  now?: Date;
};

/** Guarda la pregunta y la respuesta (una transacción, SIN el modelo dentro). */
export async function saveExchange(input: SaveExchangeInput): Promise<{ threadId: string; question: AssistantMessageDto; answer: AssistantMessageDto }> {
  const now = input.now ?? new Date();
  const qId = newId("assistantMessage");
  const aId = newId("assistantMessage");
  // La respuesta va un milisegundo después: el orden del hilo no depende del reloj de la BD.
  const answeredAt = new Date(now.getTime() + 1);
  const threadId = await getDb().transaction(async (tx) => {
    let id = input.threadId;
    if (id) {
      await tx
        .update(schema.assistantThread)
        .set({ updatedAt: answeredAt, archivedAt: null })
        .where(
          scoped(
            schema.assistantThread.organizationId,
            input.organizationId,
            eq(schema.assistantThread.id, id),
            eq(schema.assistantThread.userId, input.userId)
          )
        );
    } else {
      id = newId("assistantThread");
      await tx.insert(schema.assistantThread).values({
        id,
        organizationId: input.organizationId,
        userId: input.userId,
        title: threadTitle(input.question),
        createdAt: now,
        updatedAt: answeredAt,
      });
    }
    await tx.insert(schema.assistantMessage).values([
      {
        id: qId,
        organizationId: input.organizationId,
        threadId: id,
        role: "user",
        content: input.question,
        maskedContent: input.maskedQuestion,
        createdAt: now,
      },
      {
        id: aId,
        organizationId: input.organizationId,
        threadId: id,
        role: "assistant",
        content: input.answer,
        maskedContent: input.maskedAnswer,
        sources: input.meta,
        promptTokens: input.usage.promptTokens,
        completionTokens: input.usage.completionTokens,
        createdAt: answeredAt,
      },
    ]);
    return id;
  });
  return {
    threadId,
    question: { id: qId, role: "user", content: input.question, createdAt: now.toISOString(), meta: null },
    answer: { id: aId, role: "assistant", content: input.answer, createdAt: answeredAt.toISOString(), meta: input.meta },
  };
}

/** Una respuesta del asistente (de un hilo de esta persona) con su meta; `null` si no existe o no es suya. */
export async function getAnswerMeta(
  organizationId: string,
  userId: string,
  threadId: string,
  messageId: string
): Promise<AssistantMessageMeta | null> {
  if (!(await ownsThread(organizationId, userId, threadId))) return null;
  const [row] = await getDb()
    .select({ sources: schema.assistantMessage.sources })
    .from(schema.assistantMessage)
    .where(
      scoped(
        schema.assistantMessage.organizationId,
        organizationId,
        eq(schema.assistantMessage.threadId, threadId),
        eq(schema.assistantMessage.id, messageId),
        eq(schema.assistantMessage.role, "assistant")
      )
    )
    .limit(1);
  return (row?.sources as AssistantMessageMeta | null) ?? null;
}

/** Guarda el meta de una respuesta (el estado de sus acciones propuestas). */
export async function saveAnswerMeta(organizationId: string, threadId: string, messageId: string, meta: AssistantMessageMeta): Promise<void> {
  await getDb()
    .update(schema.assistantMessage)
    .set({ sources: meta })
    .where(
      scoped(
        schema.assistantMessage.organizationId,
        organizationId,
        eq(schema.assistantMessage.threadId, threadId),
        eq(schema.assistantMessage.id, messageId)
      )
    );
}

/** Archiva (o desarchiva) hilos de esta persona. El Chat general no se archiva. Devuelve cuántos. */
export async function archiveThreads(organizationId: string, userId: string, threadIds: string[], archived: boolean, now = new Date()): Promise<number> {
  if (threadIds.length === 0) return 0;
  const rows = await getDb()
    .update(schema.assistantThread)
    .set({ archivedAt: archived ? now : null })
    .where(
      scoped(
        schema.assistantThread.organizationId,
        organizationId,
        eq(schema.assistantThread.userId, userId),
        eq(schema.assistantThread.kind, "thread"),
        inArray(schema.assistantThread.id, threadIds),
        archived ? isNull(schema.assistantThread.archivedAt) : isNotNull(schema.assistantThread.archivedAt)
      )
    )
    .returning({ id: schema.assistantThread.id });
  return rows.length;
}

/** Borra hilos de esta persona (los de otra, ni los toca; el Chat general tampoco). Devuelve cuántos. */
export async function deleteThreads(organizationId: string, userId: string, threadIds: string[]): Promise<number> {
  if (threadIds.length === 0) return 0;
  const rows = await getDb()
    .delete(schema.assistantThread)
    .where(
      scoped(
        schema.assistantThread.organizationId,
        organizationId,
        eq(schema.assistantThread.userId, userId),
        eq(schema.assistantThread.kind, "thread"),
        inArray(schema.assistantThread.id, threadIds)
      )
    )
    .returning({ id: schema.assistantThread.id });
  return rows.length;
}

export { ownsThread };
