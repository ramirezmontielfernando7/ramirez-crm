import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scopedContacts, type Access } from "@/lib/db/tenant";
import type { SseEvent } from "@/server/events/bus";

/**
 * 020 — ¿Le llega este evento a esta sesión?
 *
 * El bus publica por organización, pero un asesor solo puede enterarse de lo
 * suyo: un `message.new` trae el texto del mensaje, y reenviárselo sería
 * enseñarle el chat de otro por la puerta de atrás. Quien ve todo lo recibe
 * todo, sin consultas.
 *
 * Falla CERRADO: un evento que no se sabe a quién pertenece no se reenvía.
 */
export async function canSeeEvent(access: Access, event: SseEvent): Promise<boolean> {
  if (access.seesAll) return true;
  switch (event.type) {
    case "message.new":
    case "message.status":
      return conversationVisible(access, event.data.conversationId);
    case "conversation.updated":
      return conversationVisible(access, conversationIdOf(event.data.conversation));
    case "assignment.changed":
      // Al que lo recibe (para que aparezca) y al que lo pierde (para que
      // desaparezca de su bandeja). Solo lleva ids.
      return (
        event.data.toUserId === access.userId ||
        event.data.fromUserIds.includes(access.userId)
      );
    case "booking.updated":
      return bookingVisible(access, event.data.bookingId);
    case "lab.run":
      return false;
    // 021: las campañas son de quien ve todo (campaigns.manage).
    case "campaign.progress":
      return false;
    default:
      return false;
  }
}

function conversationIdOf(conversation: unknown): string | null {
  if (conversation && typeof conversation === "object" && "id" in conversation) {
    const id = (conversation as { id: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

async function conversationVisible(
  access: Access,
  conversationId: string | null
): Promise<boolean> {
  if (!conversationId) return false;
  const rows = await getDb()
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      scopedContacts(
        schema.conversation.organizationId,
        access,
        schema.conversation.contactId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

async function bookingVisible(access: Access, bookingId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.booking.id, contactId: schema.booking.contactId })
    .from(schema.booking)
    .where(
      scopedContacts(
        schema.booking.organizationId,
        access,
        schema.booking.contactId,
        eq(schema.booking.id, bookingId)
      )
    )
    .limit(1);
  return rows.length > 0;
}
