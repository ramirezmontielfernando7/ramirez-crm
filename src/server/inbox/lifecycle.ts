import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scopedContacts, type Access } from "@/lib/db/tenant";
import { logger } from "@/lib/log";

const log = logger("bandeja");

/**
 * 034 — Ciclo de vida de una conversación en la Bandeja: archivar,
 * desarchivar y eliminar. La ÚNICA puerta de `conversation.archived_at` y del
 * borrado de conversaciones (el permiso de eliminar lo valida la ruta con
 * `conversation.delete`; aquí se vuelve a comprobar que la sesión VE el chat).
 */

/**
 * Archiva (`true`) o recupera (`false`) un chat. Archivado = fuera de la
 * Bandeja principal, pero conservado con todo su historial. Solo si la
 * sesión puede verlo (020); si no, `null` (la ruta responde 404).
 */
export async function setConversationArchived(
  access: Access,
  conversationId: string,
  archived: boolean
) {
  const updated = await getDb()
    .update(schema.conversation)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(
      scopedContacts(
        schema.conversation.organizationId,
        access,
        schema.conversation.contactId,
        eq(schema.conversation.id, conversationId),
        // Los chats del Laboratorio no viven en la Bandeja.
        eq(schema.conversation.isTest, false)
      )
    )
    .returning();
  return updated[0] ?? null;
}

/**
 * Elimina el chat y todos sus mensajes, para siempre. El contacto y su lead
 * se conservan: si el cliente vuelve a escribir, el chat renace vacío. Los
 * mensajes (y la atribución de anuncio del chat) se van por cascada de FK.
 * Devuelve `false` si la sesión no ve el chat.
 */
export async function deleteConversation(
  access: Access,
  conversationId: string
): Promise<boolean> {
  const deleted = await getDb()
    .delete(schema.conversation)
    .where(
      scopedContacts(
        schema.conversation.organizationId,
        access,
        schema.conversation.contactId,
        eq(schema.conversation.id, conversationId),
        eq(schema.conversation.isTest, false)
      )
    )
    .returning({ id: schema.conversation.id });
  if (!deleted[0]) return false;

  // Solo ids: nada del contenido del chat va al log.
  log.info("conversación eliminada", {
    org: access.organizationId,
    conversacion: conversationId,
    por: access.userId,
  });
  return true;
}
