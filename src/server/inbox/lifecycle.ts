import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { companyChat, scopedContacts, type Access } from "@/lib/db/tenant";
import { logger } from "@/lib/log";
import { deleteMediaFile } from "@/server/whatsapp/media";

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
        companyChat()
      )
    )
    .returning();
  return updated[0] ?? null;
}

/**
 * Elimina el chat y todos sus mensajes, para siempre. El contacto y su lead
 * se conservan: si el cliente vuelve a escribir, el chat renace vacío. Los
 * mensajes (y la atribución de anuncio del chat) se van por cascada de FK, y
 * sus archivos (fila de `media_asset` y archivo en disco) también, salvo los
 * que otro mensaje, plantilla o anuncio todavía use.
 * Devuelve `false` si la sesión no ve el chat.
 */
export async function deleteConversation(
  access: Access,
  conversationId: string
): Promise<boolean> {
  const db = getDb();
  // Archivos del chat, antes de que la cascada borre las referencias.
  const mensajes = await db
    .select({ id: schema.message.mediaAssetId })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, access.organizationId),
        eq(schema.message.conversationId, conversationId),
        isNotNull(schema.message.mediaAssetId)
      )
    );
  const anuncios = await db
    .select({ id: schema.adAttribution.imageAssetId })
    .from(schema.adAttribution)
    .where(
      and(
        eq(schema.adAttribution.organizationId, access.organizationId),
        eq(schema.adAttribution.conversationId, conversationId),
        isNotNull(schema.adAttribution.imageAssetId)
      )
    );
  const candidatos = [...new Set([...mensajes, ...anuncios].map((r) => r.id!))];

  const deleted = await db
    .delete(schema.conversation)
    .where(
      scopedContacts(
        schema.conversation.organizationId,
        access,
        schema.conversation.contactId,
        eq(schema.conversation.id, conversationId),
        companyChat()
      )
    )
    .returning({ id: schema.conversation.id });
  if (!deleted[0]) return false;

  const archivos = await borrarArchivosHuerfanos(access.organizationId, candidatos);

  // Solo ids: nada del contenido del chat va al log.
  log.info("conversación eliminada", {
    org: access.organizationId,
    conversacion: conversationId,
    por: access.userId,
    archivos,
  });
  return true;
}

/**
 * Borra de `media_asset` (y del disco) los archivos candidatos que ya nadie
 * usa. Un fallo con el disco deja un archivo huérfano, nunca un chat a medias.
 */
async function borrarArchivosHuerfanos(organizationId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const a = schema.mediaAsset;
  const borrados = await getDb()
    .delete(a)
    .where(
      and(
        eq(a.organizationId, organizationId),
        inArray(a.id, ids),
        sql`not exists (select 1 from message m where m.organization_id = ${a.organizationId} and m.media_asset_id = ${a.id})`,
        sql`not exists (select 1 from template t where t.organization_id = ${a.organizationId} and t.header_media_asset_id = ${a.id})`,
        sql`not exists (select 1 from ad_attribution x where x.organization_id = ${a.organizationId} and x.image_asset_id = ${a.id})`
      )
    )
    .returning({ id: a.id });
  for (const { id } of borrados) {
    try {
      await deleteMediaFile(organizationId, id);
    } catch (err) {
      log.warn("no se pudo borrar el archivo de un chat eliminado", { org: organizationId, archivo: id, error: String(err) });
    }
  }
  return borrados.length;
}
