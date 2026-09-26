import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { describeError } from "@/lib/log-safe";

/**
 * 022 — La ÚNICA puerta que escribe `contact_activity_event`: lo que le pasa
 * a un contacto y no tiene bitácora propia (notas, pausas de la IA,
 * consentimiento, etiquetas). Etapas y asignaciones ya la tienen
 * (`lead_stage_event`, `contact_assignment_event`); la línea de tiempo las
 * junta al leer (`timeline.ts`).
 */

export type ActivityKind = (typeof schema.contactActivityEvent.$inferInsert)["kind"];
export type ActivitySource = NonNullable<
  (typeof schema.contactActivityEvent.$inferInsert)["source"]
>;

export type ActivityInput = {
  organizationId: string;
  contactId: string;
  kind: ActivityKind;
  /** Quién; NULL cuando no fue una persona. */
  actorUserId?: string | null;
  source?: ActivitySource;
  detail?: Record<string, string | null>;
  occurredAt?: Date;
};

type Db = Pick<ReturnType<typeof getDb>, "insert">;

export async function logActivity(input: ActivityInput, db: Db = getDb()) {
  const row = {
    id: newId("activityEvent"),
    organizationId: input.organizationId,
    contactId: input.contactId,
    kind: input.kind,
    actorUserId: input.actorUserId ?? null,
    source: input.source ?? (input.actorUserId ? "usuario" : "sistema"),
    detail: input.detail ?? null,
    occurredAt: input.occurredAt ?? new Date(),
  } satisfies typeof schema.contactActivityEvent.$inferInsert;
  await db.insert(schema.contactActivityEvent).values(row);
  return row;
}

/**
 * Para las anotaciones AL MARGEN de una operación que ya ocurrió (pausar la
 * IA, cambiar etiquetas): si la bitácora falla, la operación no se revierte
 * ni se reporta como fallida — se pierde la línea y queda en el log.
 */
export async function logActivitySafe(input: ActivityInput): Promise<void> {
  try {
    await logActivity(input);
  } catch (err) {
    console.error("[actividad] no se pudo anotar en la línea de tiempo:", input.kind, describeError(err));
  }
}
