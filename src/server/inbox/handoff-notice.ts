import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { describeError } from "@/lib/log-safe";
import { publish } from "@/server/events/bus";

/**
 * 026 — El AVISO de handoff ("este chat necesita a una persona"), aparte del
 * cambio de estado (`conversation.updated`, que le llega a quien ve el chat,
 * participantes incluidos).
 *
 * A quién le llega (decisión del dueño, Bloque C):
 *  - chat asignado → al asesor asignado, a los Coordinadores y al Propietario;
 *  - chat sin asignar → a Coordinadores y Propietario, como hoy;
 *  - a los PARTICIPANTES, nunca: ven el chat, pero no son quienes deben
 *    tomarlo.
 * Coordinadores y Propietario lo reciben por ver todo (`seesAll`); el
 * asesor, porque `assignedUserId` es él (`canSeeEvent`).
 *
 * Nunca rompe el handoff: si falla, se registra sin datos y la conversación
 * igual queda en pausa (el estado es lo que importa; esto es el aviso).
 */
export async function announceHandoff(
  organizationId: string,
  conversationId: string,
  reason: string
): Promise<void> {
  try {
    const [row] = await getDb()
      .select({
        contactId: schema.contact.id,
        contactName: schema.contact.name,
        assignedUserId: schema.contact.assignedUserId,
      })
      .from(schema.conversation)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
      .where(eq(schema.conversation.id, conversationId))
      .limit(1);
    if (!row) return;
    publish(organizationId, {
      type: "handoff.requested",
      data: {
        conversationId,
        contactId: row.contactId,
        contactName: row.contactName,
        reason,
        assignedUserId: row.assignedUserId,
      },
    });
  } catch (err) {
    console.error("[handoff] no se pudo publicar el aviso:", describeError(err));
  }
}
