import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { roleLabel } from "@/lib/auth/permissions";
import { publish } from "@/server/events/bus";

/**
 * 026 — Participantes de un chat de cliente: la ÚNICA puerta que escribe
 * `contact_participant` y su bitácora `contact_participant_event`.
 *
 * Un participante VE y ATIENDE el chat (lee, responde, anota) además del
 * asignado, porque `scopedContacts()` lo incluye. No cambia de quién es el
 * chat: la asignación principal (`contact.assigned_user_id`, puerta
 * `assign.ts`) sigue siendo la única fuente de verdad, y reasignar no borra
 * participantes. Tampoco recibe el aviso de handoff (ver `handoff-notice.ts`).
 *
 * Quién los agrega o quita lo decide la ruta (`assignment.manage`).
 */

export type ParticipantDto = {
  userId: string;
  name: string;
  role: string;
  addedAt: string;
  addedBy: { id: string; name: string } | null;
};

export type ParticipantEventDto = {
  id: string;
  action: "added" | "removed";
  user: { id: string; name: string } | null;
  actor: { id: string; name: string } | null;
  occurredAt: string;
};

export class ParticipantError extends Error {
  constructor(
    public status: 404 | 409 | 422,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ParticipantError";
  }
}

async function contactOrNotFound(organizationId: string, contactId: string) {
  const [row] = await getDb()
    .select({ id: schema.contact.id, assignedUserId: schema.contact.assignedUserId })
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId)))
    .limit(1);
  if (!row) throw new ParticipantError(404, "not_found", "Contacto no encontrado");
  return row;
}

async function userNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await getDb()
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(inArray(schema.user.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Participantes actuales (miembros vigentes de la organización). */
export async function listParticipants(
  organizationId: string,
  contactId: string
): Promise<ParticipantDto[]> {
  const cp = schema.contactParticipant;
  const rows = await getDb()
    .select({
      userId: cp.userId,
      addedByUserId: cp.addedByUserId,
      createdAt: cp.createdAt,
      name: schema.user.name,
      role: schema.member.role,
    })
    .from(cp)
    .innerJoin(schema.user, eq(schema.user.id, cp.userId))
    // Quien salió de la organización no cuenta (su fila se va con la baja
    // del usuario; si solo salió del negocio, aquí ya no aparece).
    .innerJoin(
      schema.member,
      and(eq(schema.member.userId, cp.userId), eq(schema.member.organizationId, cp.organizationId))
    )
    .where(scoped(cp.organizationId, organizationId, eq(cp.contactId, contactId)))
    .orderBy(asc(cp.createdAt));
  const names = await userNames(rows.map((r) => r.addedByUserId ?? ""));
  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    role: roleLabel(r.role),
    addedAt: r.createdAt.toISOString(),
    addedBy: r.addedByUserId ? { id: r.addedByUserId, name: names.get(r.addedByUserId) ?? "Usuario" } : null,
  }));
}

function announce(organizationId: string, contactId: string, userId: string) {
  // Al que entra (para que el chat aparezca en su Bandeja) y al que sale
  // (para que desaparezca). Quien ve todo lo recibe igual.
  publish(organizationId, {
    type: "participants.changed",
    data: { contactIds: [contactId], userIds: [userId] },
  });
}

export async function addParticipant(input: {
  organizationId: string;
  contactId: string;
  userId: string;
  actorUserId: string;
}): Promise<{ added: boolean }> {
  const { organizationId, contactId, userId, actorUserId } = input;
  const contact = await contactOrNotFound(organizationId, contactId);
  const [member] = await getDb()
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(scoped(schema.member.organizationId, organizationId, eq(schema.member.userId, userId)))
    .limit(1);
  if (!member) throw new ParticipantError(422, "invalid_user", "Esa persona no es del equipo");
  if (contact.assignedUserId === userId) {
    throw new ParticipantError(409, "is_assignee", "Esa persona ya es la asignada de este chat");
  }
  const added = await getDb().transaction(async (tx) => {
    const rows = await tx
      .insert(schema.contactParticipant)
      .values({ organizationId, contactId, userId, addedByUserId: actorUserId })
      .onConflictDoNothing()
      .returning({ userId: schema.contactParticipant.userId });
    if (rows.length === 0) return false; // ya estaba: idempotente, sin bitácora doble
    await tx.insert(schema.contactParticipantEvent).values({
      id: newId("participantEvent"),
      organizationId,
      contactId,
      userId,
      action: "added",
      actorUserId,
    });
    return true;
  });
  if (added) announce(organizationId, contactId, userId);
  return { added };
}

export async function removeParticipant(input: {
  organizationId: string;
  contactId: string;
  userId: string;
  actorUserId: string;
}): Promise<{ removed: boolean }> {
  const { organizationId, contactId, userId, actorUserId } = input;
  await contactOrNotFound(organizationId, contactId);
  const removed = await getDb().transaction(async (tx) => {
    const rows = await tx
      .delete(schema.contactParticipant)
      .where(
        scoped(
          schema.contactParticipant.organizationId,
          organizationId,
          eq(schema.contactParticipant.contactId, contactId),
          eq(schema.contactParticipant.userId, userId)
        )
      )
      .returning({ userId: schema.contactParticipant.userId });
    if (rows.length === 0) return false;
    await tx.insert(schema.contactParticipantEvent).values({
      id: newId("participantEvent"),
      organizationId,
      contactId,
      userId,
      action: "removed",
      actorUserId,
    });
    return true;
  });
  if (removed) announce(organizationId, contactId, userId);
  return { removed };
}

/** Bitácora para la línea de tiempo del chat. */
export async function listParticipantHistory(
  organizationId: string,
  contactId: string
): Promise<ParticipantEventDto[]> {
  const e = schema.contactParticipantEvent;
  const rows = await getDb()
    .select()
    .from(e)
    .where(scoped(e.organizationId, organizationId, eq(e.contactId, contactId)))
    .orderBy(asc(e.occurredAt));
  const names = await userNames(rows.flatMap((r) => [r.userId ?? "", r.actorUserId ?? ""]));
  const pick = (id: string | null) => (id ? { id, name: names.get(id) ?? "Usuario" } : null);
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    user: pick(r.userId),
    actor: pick(r.actorUserId),
    occurredAt: r.occurredAt.toISOString(),
  }));
}
