import { asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";

/**
 * 020 — La ÚNICA puerta que escribe `contact.assigned_user_id`.
 *
 * Mismo contrato que `moveLeadToStage`: cambiar de dueño y anotarlo en la
 * bitácora (`contact_assignment_event`) son la MISMA operación, en la misma
 * transacción. Si un segundo camino asignara por su cuenta, el historial
 * ("¿quién tenía este lead y desde cuándo?") nacería con huecos que nadie
 * notaría hasta que hiciera falta.
 *
 * Un unit test de vigilancia (`tests/unit/assignment-guard.test.ts`) escanea
 * `src/` y falla si aparece otra escritura de `assignedUserId`. No lo
 * "arregles" moviendo el UPDATE: enruta tu cambio por aquí.
 */

export type AssignmentSource = "manual" | "lote" | "auto" | "sistema" | "migracion";

export type AssignInput = {
  organizationId: string;
  contactIds: string[];
  /** NULL = dejar sin asignar. */
  toUserId: string | null;
  /** Quién reasignó; NULL cuando no fue una persona. */
  actorUserId: string | null;
  source: AssignmentSource;
  reason?: string | null;
  /** Agrupa los movimientos de un lote; se genera si es `lote` y no viene. */
  batchId?: string | null;
};

export type AssignResult =
  | { ok: true; changed: string[]; batchId: string | null }
  | { ok: false; reason: "assignee_not_member" | "contact_not_found" };

/** ¿Es esta persona miembro del negocio? Solo un miembro recibe chats. */
export async function isMemberOf(
  organizationId: string,
  userId: string
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      scoped(
        schema.member.organizationId,
        organizationId,
        eq(schema.member.userId, userId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function assignContacts(input: AssignInput): Promise<AssignResult> {
  const ids = [...new Set(input.contactIds)];
  if (ids.length === 0) return { ok: true, changed: [], batchId: null };

  if (input.toUserId && !(await isMemberOf(input.organizationId, input.toUserId))) {
    return { ok: false, reason: "assignee_not_member" };
  }

  const batchId =
    input.batchId ?? (input.source === "lote" ? newId("assignmentBatch") : null);
  const db = getDb();
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    // FOR UPDATE: dos reasignaciones simultáneas del mismo contacto se
    // serializan, y cada evento anota el `from` que de verdad había.
    const current = await tx
      .select({
        id: schema.contact.id,
        assignedUserId: schema.contact.assignedUserId,
      })
      .from(schema.contact)
      .where(
        scoped(
          schema.contact.organizationId,
          input.organizationId,
          inArray(schema.contact.id, ids)
        )
      )
      .for("update");

    if (current.length !== ids.length) {
      return { ok: false as const, reason: "contact_not_found" as const };
    }

    const cambian = current.filter((c) => c.assignedUserId !== input.toUserId);
    if (cambian.length === 0) {
      return {
        ok: true as const,
        changed: [] as string[],
        batchId,
        fromUserIds: [] as string[],
      };
    }
    const changedIds = cambian.map((c) => c.id);

    await tx
      .update(schema.contact)
      .set({ assignedUserId: input.toUserId, assignedAt: now, updatedAt: now })
      .where(
        scoped(
          schema.contact.organizationId,
          input.organizationId,
          inArray(schema.contact.id, changedIds)
        )
      );

    const leads = await tx
      .select({ id: schema.lead.id, contactId: schema.lead.contactId })
      .from(schema.lead)
      .where(
        scoped(
          schema.lead.organizationId,
          input.organizationId,
          inArray(schema.lead.contactId, changedIds)
        )
      );
    const leadDe = new Map(leads.map((l) => [l.contactId, l.id]));

    await tx.insert(schema.contactAssignmentEvent).values(
      cambian.map((c) => ({
        id: newId("assignmentEvent"),
        organizationId: input.organizationId,
        contactId: c.id,
        leadId: leadDe.get(c.id) ?? null,
        fromUserId: c.assignedUserId,
        toUserId: input.toUserId,
        actorUserId: input.actorUserId,
        source: input.source,
        reason: input.reason ?? null,
        batchId,
        occurredAt: now,
      }))
    );

    return {
      ok: true as const,
      changed: changedIds,
      batchId,
      fromUserIds: [
        ...new Set(
          cambian.map((c) => c.assignedUserId).filter((u): u is string => !!u)
        ),
      ],
    };
  });

  if (!result.ok) return result;

  // Tras el commit (contrato del bus): la bandeja de quien lo recibe y la de
  // quien lo pierde se refrescan solas.
  if (result.changed.length > 0) {
    publish(input.organizationId, {
      type: "assignment.changed",
      data: {
        contactIds: result.changed,
        toUserId: input.toUserId,
        fromUserIds: result.fromUserIds,
      },
    });
  }
  return { ok: true, changed: result.changed, batchId: result.batchId };
}

/**
 * Lote "se va de vacaciones": todo lo que tiene asignado `fromUserId` pasa a
 * `toUserId` (o queda sin asignar), en un solo `batch_id`.
 */
export async function reassignAllFrom(input: {
  organizationId: string;
  fromUserId: string;
  toUserId: string | null;
  actorUserId: string | null;
  source?: AssignmentSource;
  reason?: string | null;
}): Promise<AssignResult> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        input.organizationId,
        eq(schema.contact.assignedUserId, input.fromUserId)
      )
    );
  return assignContacts({
    organizationId: input.organizationId,
    contactIds: rows.map((r) => r.id),
    toUserId: input.toUserId,
    actorUserId: input.actorUserId,
    source: input.source ?? "lote",
    reason: input.reason ?? null,
  });
}

export type AssignmentEventDto = {
  id: string;
  fromUser: { id: string; name: string } | null;
  toUser: { id: string; name: string } | null;
  actor: { id: string; name: string } | null;
  source: AssignmentSource;
  reason: string | null;
  occurredAt: string;
};

/** Historial de un contacto, del más antiguo al más reciente. */
export async function listAssignmentHistory(
  organizationId: string,
  contactId: string
): Promise<AssignmentEventDto[]> {
  const db = getDb();
  const rows = await db
    .select({
      event: schema.contactAssignmentEvent,
      users: sql<{ id: string; name: string }[]>`(
        select coalesce(json_agg(json_build_object('id', u."id", 'name', u."name")), '[]'::json)
        from "user" u
        where u."id" in (
          ${schema.contactAssignmentEvent.fromUserId},
          ${schema.contactAssignmentEvent.toUserId},
          ${schema.contactAssignmentEvent.actorUserId}
        )
      )`,
    })
    .from(schema.contactAssignmentEvent)
    .where(
      scoped(
        schema.contactAssignmentEvent.organizationId,
        organizationId,
        eq(schema.contactAssignmentEvent.contactId, contactId)
      )
    )
    .orderBy(
      asc(schema.contactAssignmentEvent.occurredAt),
      asc(schema.contactAssignmentEvent.createdAt)
    );

  return rows.map(({ event, users }) => {
    const byId = new Map((users ?? []).map((u) => [u.id, u]));
    const pick = (id: string | null) => (id ? byId.get(id) ?? null : null);
    return {
      id: event.id,
      fromUser: pick(event.fromUserId),
      toUser: pick(event.toUserId),
      actor: pick(event.actorUserId),
      source: event.source,
      reason: event.reason,
      occurredAt: event.occurredAt.toISOString(),
    };
  });
}

/** Miembros que pueden recibir chats, para los selectores "Asignar a". */
export async function listAssignees(
  organizationId: string
): Promise<{ id: string; name: string; role: string }[]> {
  const db = getDb();
  return db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(scoped(schema.member.organizationId, organizationId))
    .orderBy(asc(schema.user.name));
}

/**
 * Al salir alguien del equipo, lo suyo queda SIN ASIGNAR (con evento
 * `sistema`) para que el coordinador lo vea y lo reparta, en vez de que
 * quede huérfano en silencio con un `set null` de la llave foránea.
 */
export async function releaseAllFrom(
  organizationId: string,
  userId: string,
  actorUserId: string | null
): Promise<AssignResult> {
  return reassignAllFrom({
    organizationId,
    fromUserId: userId,
    toUserId: null,
    actorUserId,
    source: "sistema",
    reason: "La persona salió del equipo",
  });
}

/** Cuántos contactos tiene cada persona (para Ajustes → Equipo). */
export async function countAssignedByUser(
  organizationId: string
): Promise<Map<string, number>> {
  const db = getDb();
  const rows = await db
    .select({
      userId: schema.contact.assignedUserId,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        isNotNull(schema.contact.assignedUserId)
      )
    )
    .groupBy(schema.contact.assignedUserId);
  return new Map(
    rows.filter((r) => r.userId).map((r) => [r.userId as string, r.n])
  );
}

