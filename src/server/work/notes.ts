import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { assignedTo, scoped, scopedContacts } from "@/lib/db/tenant";
import { canEditNote, type NoteColor, type NoteDto } from "@/lib/work";
import { getContactById } from "@/server/contacts";
import { getConversation } from "@/server/inbox/queries";
import type { Viewer } from "./tasks";

/**
 * 033, PR 2 — Notas: la ÚNICA puerta que lee y escribe `work_note`.
 *
 * Quién ve una nota:
 *   - sin ligar: SOLO quien la escribió (ni el Propietario la ve);
 *   - ligada a un contacto/chat: quien puede ver ese contacto (020, la misma
 *     regla de la Bandeja: asignado, participante o `scope.all`).
 * Editar, fijar, archivar o borrar: quien la escribió, o `work.manage`
 * (Propietario y Coordinador) sobre las que ve.
 *
 * Nada de aquí habla con Meta: una nota jamás sale al cliente, tampoco en
 * conversaciones de prueba.
 */

type Row = typeof schema.workNote.$inferSelect;

const LIST_LIMIT = 300;

/** La condición «esta nota la puede ver quien pide». */
function visibleTo(v: Viewer): SQL {
  const mine = eq(schema.workNote.authorUserId, v.access.userId);
  const contactVisible = assignedTo(v.access, schema.workNote.contactId);
  const linked = contactVisible
    ? and(isNotNull(schema.workNote.contactId), contactVisible)!
    : isNotNull(schema.workNote.contactId);
  return or(mine, linked)!;
}

/**
 * La pestaña Notas: las que escribió quien pide (las del equipo se ven en
 * cada chat). Fijadas primero; luego, lo más reciente.
 */
export async function listMyNotes(v: Viewer, opts: { archived: boolean }): Promise<NoteDto[]> {
  const rows = await getDb()
    .select()
    .from(schema.workNote)
    .where(
      scoped(
        schema.workNote.organizationId,
        v.access.organizationId,
        eq(schema.workNote.authorUserId, v.access.userId),
        opts.archived ? isNotNull(schema.workNote.archivedAt) : isNull(schema.workNote.archivedAt)
      )
    )
    .orderBy(sql`${schema.workNote.pinnedAt} desc nulls last`, desc(schema.workNote.updatedAt))
    .limit(LIST_LIMIT);
  return serialize(v, rows);
}

/** Las notas ligadas a un contacto (sin archivar). null si el contacto no se ve. */
export async function listContactNotes(v: Viewer, contactId: string): Promise<NoteDto[] | null> {
  if (!(await getContactById(v.access, contactId))) return null;
  const rows = await getDb()
    .select()
    .from(schema.workNote)
    .where(
      scoped(
        schema.workNote.organizationId,
        v.access.organizationId,
        eq(schema.workNote.contactId, contactId),
        isNull(schema.workNote.archivedAt)
      )
    )
    .orderBy(sql`${schema.workNote.pinnedAt} desc nulls last`, desc(schema.workNote.updatedAt))
    .limit(LIST_LIMIT);
  return serialize(v, rows);
}

async function getNoteRow(v: Viewer, id: string): Promise<Row | null> {
  const [row] = await getDb()
    .select()
    .from(schema.workNote)
    .where(scoped(schema.workNote.organizationId, v.access.organizationId, visibleTo(v), eq(schema.workNote.id, id)))
    .limit(1);
  return row ?? null;
}

export async function getNote(v: Viewer, id: string): Promise<NoteDto | null> {
  const row = await getNoteRow(v, id);
  return row ? (await serialize(v, [row]))[0]! : null;
}

export class NoteInputError extends Error {
  constructor(
    readonly code: "invalid_link" | "empty_note",
    message: string
  ) {
    super(message);
    this.name = "NoteInputError";
  }
}

/** Con conversación, el contacto sale de ella. Solo lo que quien escribe puede ver. */
async function resolveLink(
  v: Viewer,
  link: { contactId?: string | null; conversationId?: string | null }
): Promise<{ contactId: string | null; conversationId: string | null }> {
  if (link.conversationId) {
    const conv = await getConversation(v.access, link.conversationId);
    if (!conv) throw new NoteInputError("invalid_link", "Esa conversación no existe o no la puedes ver");
    return { contactId: conv.contact.id, conversationId: conv.conversation.id };
  }
  if (link.contactId) {
    const c = await getContactById(v.access, link.contactId);
    if (!c) throw new NoteInputError("invalid_link", "Ese contacto no existe o no lo puedes ver");
    return { contactId: c.id, conversationId: null };
  }
  return { contactId: null, conversationId: null };
}

export type NoteInput = {
  title?: string | null;
  body?: string;
  color?: NoteColor;
  contactId?: string | null;
  conversationId?: string | null;
};

function emptyNote(title: string | null | undefined, body: string | undefined): boolean {
  return !(title ?? "").trim() && !(body ?? "").trim();
}

export async function createNote(v: Viewer, input: NoteInput): Promise<NoteDto> {
  if (emptyNote(input.title, input.body)) throw new NoteInputError("empty_note", "Escribe algo en la nota");
  const link = await resolveLink(v, input);
  const [row] = await getDb()
    .insert(schema.workNote)
    .values({
      id: newId("workNote"),
      organizationId: v.access.organizationId,
      title: input.title?.trim() || null,
      body: input.body ?? "",
      color: input.color ?? "ninguno",
      authorUserId: v.access.userId,
      ...link,
    })
    .returning();
  return (await serialize(v, [row!]))[0]!;
}

export type NotePatch = NoteInput & { pinned?: boolean; archived?: boolean };

/** null = no existe para quien pide (404); "forbidden" = la ve pero no la puede tocar. */
export async function updateNote(v: Viewer, id: string, patch: NotePatch): Promise<NoteDto | null | "forbidden"> {
  const current = await getNoteRow(v, id);
  if (!current) return null;
  if (!canEditNote(current, v.access.userId, v.manages)) return "forbidden";
  const title = patch.title === undefined ? current.title : patch.title?.trim() || null;
  const body = patch.body === undefined ? current.body : patch.body;
  if (emptyNote(title, body)) throw new NoteInputError("empty_note", "Escribe algo en la nota");
  const relinks = patch.contactId !== undefined || patch.conversationId !== undefined;
  const link = relinks ? await resolveLink(v, patch) : null;
  const now = new Date();
  const [row] = await getDb()
    .update(schema.workNote)
    .set({
      title,
      body,
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.pinned === true && !current.pinnedAt ? { pinnedAt: now } : {}),
      ...(patch.pinned === false ? { pinnedAt: null } : {}),
      ...(patch.archived === true && !current.archivedAt ? { archivedAt: now } : {}),
      ...(patch.archived === false ? { archivedAt: null } : {}),
      ...(link ?? {}),
      updatedAt: now,
    })
    .where(scoped(schema.workNote.organizationId, v.access.organizationId, eq(schema.workNote.id, id)))
    .returning();
  return row ? (await serialize(v, [row]))[0]! : null;
}

export async function deleteNote(v: Viewer, id: string): Promise<boolean | "forbidden"> {
  const current = await getNoteRow(v, id);
  if (!current) return false;
  if (!canEditNote(current, v.access.userId, v.manages)) return "forbidden";
  await getDb()
    .delete(schema.workNote)
    .where(scoped(schema.workNote.organizationId, v.access.organizationId, eq(schema.workNote.id, id)));
  return true;
}

/** Nombre del autor y, SOLO de los contactos que quien mira puede ver, el suyo. */
async function serialize(v: Viewer, rows: Row[]): Promise<NoteDto[]> {
  if (rows.length === 0) return [];
  const orgId = v.access.organizationId;
  const db = getDb();
  const authorIds = [...new Set(rows.map((r) => r.authorUserId).filter((x): x is string => !!x))];
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter((x): x is string => !!x))];
  const [people, contacts] = await Promise.all([
    authorIds.length
      ? db
          .select({ id: schema.user.id, name: schema.user.name })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
          .where(scoped(schema.member.organizationId, orgId, inArray(schema.member.userId, authorIds)))
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
  return rows.map((r) => {
    const seen = r.contactId ? contactName.has(r.contactId) : false;
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      color: r.color as NoteColor,
      pinned: !!r.pinnedAt,
      archived: !!r.archivedAt,
      author: r.authorUserId ? { id: r.authorUserId, name: personName.get(r.authorUserId) ?? "Ya no está en el equipo" } : null,
      contact: seen && r.contactId ? { id: r.contactId, name: contactName.get(r.contactId)! } : null,
      hiddenContact: !!r.contactId && !seen,
      conversationId: seen ? r.conversationId : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      canEdit: canEditNote(r, v.access.userId, v.manages),
    };
  });
}
