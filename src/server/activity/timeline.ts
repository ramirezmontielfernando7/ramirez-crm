import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { listAssignmentHistory } from "@/server/assignment/assign";
import { sortTimeline, type TimelineActor, type TimelineItemDto } from "@/lib/timeline";

/**
 * 022 — La línea de tiempo de un contacto: junta, al leer, las tres
 * bitácoras append-only (etapas, asignaciones y `contact_activity_event`) más
 * la nota heredada de `contact.notes` como "Nota inicial". No guarda nada
 * propio: cada evento vive en la tabla de su dueño.
 *
 * Quien llama YA validó que la persona puede ver el contacto
 * (`getContactById` con `scopedContacts`): la línea de tiempo es completa —
 * incluye lo que pasó mientras el chat era de otro — a propósito (spec 022).
 */

/** Tope: un contacto con más historia muestra lo reciente. */
export const TIMELINE_LIMIT = 200;

function userActor(id: string | null, name: string | null): TimelineActor | null {
  return id && name ? { type: "user", id, name } : null;
}

export async function contactTimeline(
  organizationId: string,
  contact: { id: string; notes: string | null; createdAt: Date }
): Promise<TimelineItemDto[]> {
  const db = getDb();
  const [activity, stages, assignments] = await Promise.all([
    db
      .select({ event: schema.contactActivityEvent, actorName: schema.user.name })
      .from(schema.contactActivityEvent)
      .leftJoin(schema.user, eq(schema.user.id, schema.contactActivityEvent.actorUserId))
      .where(
        scoped(
          schema.contactActivityEvent.organizationId,
          organizationId,
          eq(schema.contactActivityEvent.contactId, contact.id)
        )
      )
      .orderBy(desc(schema.contactActivityEvent.occurredAt))
      .limit(TIMELINE_LIMIT),
    db
      .select({ event: schema.leadStageEvent, actorName: schema.user.name })
      .from(schema.leadStageEvent)
      .leftJoin(schema.user, eq(schema.user.id, schema.leadStageEvent.actorUserId))
      .where(
        scoped(
          schema.leadStageEvent.organizationId,
          organizationId,
          eq(schema.leadStageEvent.contactId, contact.id)
        )
      )
      .orderBy(desc(schema.leadStageEvent.occurredAt))
      .limit(TIMELINE_LIMIT),
    listAssignmentHistory(organizationId, contact.id),
  ]);

  const items: TimelineItemDto[] = [];

  if (contact.notes?.trim()) {
    items.push({
      id: `initial_${contact.id}`,
      kind: "initial_note",
      at: contact.createdAt.toISOString(),
      actor: null,
      detail: { text: contact.notes },
    });
  }

  for (const { event: e, actorName } of activity) {
    const actor: TimelineActor | null =
      userActor(e.actorUserId, actorName) ??
      (e.source === "bot" ? { type: "bot" } : e.source === "api" ? { type: "api" } : null);
    const kind =
      e.kind === "note_added"
        ? "note"
        : e.kind === "consent_changed"
          ? "consent"
          : e.kind;
    items.push({
      id: e.id,
      kind,
      at: e.occurredAt.toISOString(),
      actor,
      detail: e.detail ?? {},
    });
  }

  for (const { event: e, actorName } of stages) {
    items.push({
      id: e.id,
      kind: "stage",
      at: e.occurredAt.toISOString(),
      actor:
        userActor(e.actorUserId, actorName) ?? (e.source === "bot" ? { type: "bot" } : null),
      detail: {
        from: e.fromStageName,
        to: e.toStageName,
        toKind: e.toStageKind,
        lossReason: e.lossReason,
        lossNote: e.lossNote,
      },
    });
  }

  for (const h of assignments) {
    items.push({
      id: h.id,
      kind: "assignment",
      at: h.occurredAt,
      actor: h.actor ? { type: "user", ...h.actor } : null,
      detail: {
        from: h.fromUser?.name ?? null,
        to: h.toUser?.name ?? null,
        source: h.source,
        reason: h.reason,
      },
    });
  }

  return sortTimeline(items).slice(0, TIMELINE_LIMIT);
}
