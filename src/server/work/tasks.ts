import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped, scopedContacts, type Access } from "@/lib/db/tenant";
import { canDeleteTask, canEditTask, type TaskDto, type TaskFilter } from "@/lib/work";
import { can } from "@/lib/auth/permissions";
import type { SessionContext } from "@/lib/auth/session";
import { getContactById } from "@/server/contacts";
import { getConversation } from "@/server/inbox/queries";
import { isMemberOf } from "@/server/assignment/assign";

/**
 * 033 — Tareas: la ÚNICA puerta que lee y escribe `work_task`.
 *
 * Quién ve qué: sin `work.manage`, solo lo que creó o tiene a su cargo; con
 * él, todo el negocio. La ligadura a un contacto o chat solo se acepta si
 * quien escribe PUEDE verlo (020), y al leer, el nombre del contacto solo se
 * muestra a quien también lo ve: una tarea no es una puerta a datos de
 * clientes ajenos. Nada de aquí habla con Meta.
 */

export type Viewer = {
  access: Access;
  /** `can(session, "work.manage")`. */
  manages: boolean;
};

export function viewerOf(session: SessionContext): Viewer {
  return { access: session.access, manages: can(session, "work.manage") };
}

type Row = typeof schema.workTask.$inferSelect;

/** Cuántas tareas devuelve una lista (Hechas es la que crece). */
const LIST_LIMIT = 300;

function visibleTo(v: Viewer): SQL | undefined {
  if (v.manages) return undefined;
  return or(
    eq(schema.workTask.createdBy, v.access.userId),
    eq(schema.workTask.assigneeUserId, v.access.userId)
  );
}

function filterCondition(filter: TaskFilter, v: Viewer, now: Date): SQL | undefined {
  const pending = isNull(schema.workTask.doneAt);
  switch (filter) {
    case "mine":
      // Lo que me toca: a mi cargo, o lo que anoté sin responsable.
      return and(
        pending,
        or(
          eq(schema.workTask.assigneeUserId, v.access.userId),
          and(isNull(schema.workTask.assigneeUserId), eq(schema.workTask.createdBy, v.access.userId))
        )
      );
    case "all":
      return pending;
    case "overdue":
      return and(pending, isNotNull(schema.workTask.dueAt), lt(schema.workTask.dueAt, now));
    case "done":
      return isNotNull(schema.workTask.doneAt);
  }
}

export async function listTasks(
  v: Viewer,
  opts: { filter: TaskFilter; contactId?: string; now?: Date }
): Promise<TaskDto[]> {
  const now = opts.now ?? new Date();
  const rows = await getDb()
    .select()
    .from(schema.workTask)
    .where(
      scoped(
        schema.workTask.organizationId,
        v.access.organizationId,
        visibleTo(v),
        filterCondition(opts.filter, v, now),
        opts.contactId ? eq(schema.workTask.contactId, opts.contactId) : undefined
      )
    )
    .orderBy(
      ...(opts.filter === "done"
        ? [desc(schema.workTask.doneAt)]
        : // Pendientes: lo que vence primero arriba; sin fecha, al final.
          [sql`${schema.workTask.dueAt} asc nulls last`, desc(schema.workTask.createdAt)])
    )
    .limit(LIST_LIMIT);
  return serialize(v, rows);
}

/** Una tarea que quien pide puede ver; si no, null (→ 404). */
export async function getTask(v: Viewer, id: string): Promise<Row | null> {
  const [row] = await getDb()
    .select()
    .from(schema.workTask)
    .where(scoped(schema.workTask.organizationId, v.access.organizationId, visibleTo(v), eq(schema.workTask.id, id)))
    .limit(1);
  return row ?? null;
}

export class TaskInputError extends Error {
  constructor(
    readonly code: "invalid_assignee" | "invalid_link",
    message: string
  ) {
    super(message);
    this.name = "TaskInputError";
  }
}

/**
 * La ligadura que quien escribe puede hacer. Con conversación, el contacto
 * sale de ella (no se puede ligar un chat de un contacto a otro contacto).
 */
async function resolveLink(
  v: Viewer,
  link: { contactId?: string | null; conversationId?: string | null }
): Promise<{ contactId: string | null; conversationId: string | null }> {
  if (link.conversationId) {
    const conv = await getConversation(v.access, link.conversationId);
    if (!conv) throw new TaskInputError("invalid_link", "Esa conversación no existe o no la puedes ver");
    return { contactId: conv.contact.id, conversationId: conv.conversation.id };
  }
  if (link.contactId) {
    const c = await getContactById(v.access, link.contactId);
    if (!c) throw new TaskInputError("invalid_link", "Ese contacto no existe o no lo puedes ver");
    return { contactId: c.id, conversationId: null };
  }
  return { contactId: null, conversationId: null };
}

async function checkAssignee(organizationId: string, userId: string | null | undefined): Promise<void> {
  if (userId && !(await isMemberOf(organizationId, userId))) {
    throw new TaskInputError("invalid_assignee", "Esa persona no es parte del equipo");
  }
}

export type TaskInput = {
  title: string;
  description?: string | null;
  dueAt?: Date | null;
  assigneeUserId?: string | null;
  contactId?: string | null;
  conversationId?: string | null;
};

export async function createTask(v: Viewer, input: TaskInput): Promise<TaskDto> {
  const orgId = v.access.organizationId;
  // Sin responsable elegido, es de quien la anota.
  const assignee = input.assigneeUserId === undefined ? v.access.userId : input.assigneeUserId;
  await checkAssignee(orgId, assignee);
  const link = await resolveLink(v, input);
  const [row] = await getDb()
    .insert(schema.workTask)
    .values({
      id: newId("workTask"),
      organizationId: orgId,
      title: input.title,
      description: input.description || null,
      dueAt: input.dueAt ?? null,
      assigneeUserId: assignee,
      createdBy: v.access.userId,
      ...link,
    })
    .returning();
  return (await serialize(v, [row!]))[0]!;
}

export type TaskPatch = Partial<TaskInput> & { done?: boolean };

/** null = no existe para quien pide (404); "forbidden" = la ve pero no la puede tocar. */
export async function updateTask(v: Viewer, id: string, patch: TaskPatch): Promise<TaskDto | null | "forbidden"> {
  const current = await getTask(v, id);
  if (!current) return null;
  if (!canEditTask(current, v.access.userId, v.manages)) return "forbidden";
  const orgId = v.access.organizationId;
  if (patch.assigneeUserId !== undefined) await checkAssignee(orgId, patch.assigneeUserId);
  const relinks = patch.contactId !== undefined || patch.conversationId !== undefined;
  const link = relinks ? await resolveLink(v, patch) : null;
  const now = new Date();
  const [row] = await getDb()
    .update(schema.workTask)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description || null } : {}),
      ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
      ...(patch.assigneeUserId !== undefined ? { assigneeUserId: patch.assigneeUserId } : {}),
      ...(link ?? {}),
      ...(patch.done === true && !current.doneAt ? { doneAt: now, doneBy: v.access.userId } : {}),
      ...(patch.done === false ? { doneAt: null, doneBy: null } : {}),
      updatedAt: now,
    })
    .where(scoped(schema.workTask.organizationId, orgId, eq(schema.workTask.id, id)))
    .returning();
  return row ? (await serialize(v, [row]))[0]! : null;
}

export async function deleteTask(v: Viewer, id: string): Promise<boolean | "forbidden"> {
  const current = await getTask(v, id);
  if (!current) return false;
  if (!canDeleteTask(current, v.access.userId, v.manages)) return "forbidden";
  await getDb()
    .delete(schema.workTask)
    .where(scoped(schema.workTask.organizationId, v.access.organizationId, eq(schema.workTask.id, id)));
  return true;
}

/** Nombres de personas y, SOLO de los contactos que quien mira puede ver, el suyo. */
async function serialize(v: Viewer, rows: Row[]): Promise<TaskDto[]> {
  if (rows.length === 0) return [];
  const orgId = v.access.organizationId;
  const db = getDb();
  const userIds = [
    ...new Set(rows.flatMap((r) => [r.assigneeUserId, r.createdBy, r.doneBy]).filter((x): x is string => !!x)),
  ];
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter((x): x is string => !!x))];
  const [people, contacts] = await Promise.all([
    userIds.length
      ? db
          .select({ id: schema.user.id, name: schema.user.name })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
          .where(scoped(schema.member.organizationId, orgId, inArray(schema.member.userId, userIds)))
      : [],
    contactIds.length
      ? db
          .select({ id: schema.contact.id, name: schema.contact.name, phone: schema.contact.phone })
          .from(schema.contact)
          .where(scopedContacts(schema.contact.organizationId, v.access, schema.contact.id, inArray(schema.contact.id, contactIds)))
          .orderBy(asc(schema.contact.id))
      : [],
  ]);
  const personName = new Map(people.map((p) => [p.id, p.name]));
  const contactName = new Map(contacts.map((c) => [c.id, c.name?.trim() || c.phone || "Sin nombre"]));
  const person = (id: string | null) =>
    id ? { id, name: personName.get(id) ?? "Ya no está en el equipo" } : null;
  return rows.map((r) => {
    const seen = r.contactId ? contactName.has(r.contactId) : false;
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      dueAt: r.dueAt?.toISOString() ?? null,
      assignee: person(r.assigneeUserId),
      createdBy: person(r.createdBy),
      contact: seen && r.contactId ? { id: r.contactId, name: contactName.get(r.contactId)! } : null,
      hiddenContact: !!r.contactId && !seen,
      conversationId: seen ? r.conversationId : null,
      doneAt: r.doneAt?.toISOString() ?? null,
      doneBy: person(r.doneBy),
      createdAt: r.createdAt.toISOString(),
      canEdit: canEditTask(r, v.access.userId, v.manages),
      canDelete: canDeleteTask(r, v.access.userId, v.manages),
    };
  });
}

/** Personas del negocio para el selector «Responsable» (sin datos de clientes). */
export async function listTaskPeople(organizationId: string): Promise<{ id: string; name: string }[]> {
  return getDb()
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(scoped(schema.member.organizationId, organizationId))
    .orderBy(asc(schema.user.name));
}
