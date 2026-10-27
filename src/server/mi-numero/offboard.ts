import { eq, inArray, isNull, like, sql } from "drizzle-orm";
import { schema, withTenant } from "@/lib/db";
import { NUMBER_MEDIA_PREFIX, scoped } from "@/lib/db/tenant";
import { logger } from "@/lib/log";
import { deleteMediaFile } from "@/server/whatsapp/media";

const log = logger("mi-numero");

export type Settled = { kept: number; deleted: number; contactsDeleted: number };

/**
 * Mi número (046), PR 6 — Lo que pasa con los chats de un número que se da de
 * baja (revocar), como lo aceptó la persona en su aviso:
 *
 * - Los chats que marcó «Es cliente» se quedan con la empresa: pasan a la
 *   Bandeja (o se juntan con el chat de la empresa con ese cliente, si ya
 *   había uno) para que otra persona los atienda.
 * - Sus chats privados se BORRAN de Dashfort, con sus archivos. Un contacto
 *   privado que ya no tiene ningún chat se borra; si otro número también
 *   habla con él, queda privado de ese otro número.
 *
 * Todo en una transacción; los archivos del disco se borran al final (un
 * fallo ahí deja un archivo huérfano, nunca un chat a medias).
 */
export async function settleNumberChats(organizationId: string, directNumberId: string): Promise<Settled> {
  const marked = `${NUMBER_MEDIA_PREFIX}${directNumberId}:%`;
  const { result, filesToDelete } = await withTenant(organizationId, async (tx) => {
    const chats = await tx
      .select({ id: schema.conversation.id, contactId: schema.conversation.contactId, clientMarkedAt: schema.conversation.clientMarkedAt })
      .from(schema.conversation)
      .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.directNumberId, directNumberId)));
    const privados = chats.filter((c) => !c.clientMarkedAt);
    const clientes = chats.filter((c) => c.clientMarkedAt);

    // 1. Archivos de los chats privados: fuera la fila (y luego el archivo).
    const files: string[] = [];
    if (privados.length > 0) {
      const assets = await tx
        .select({ id: schema.mediaAsset.id })
        .from(schema.mediaAsset)
        .innerJoin(schema.message, eq(schema.message.mediaAssetId, schema.mediaAsset.id))
        .where(
          scoped(
            schema.mediaAsset.organizationId,
            organizationId,
            inArray(schema.message.conversationId, privados.map((c) => c.id)),
            like(schema.mediaAsset.waMediaId, marked)
          )
        );
      files.push(...assets.map((a) => a.id));
      await tx.delete(schema.conversation).where(
        scoped(schema.conversation.organizationId, organizationId, inArray(schema.conversation.id, privados.map((c) => c.id)))
      );
      if (files.length > 0) {
        await tx.delete(schema.mediaAsset).where(scoped(schema.mediaAsset.organizationId, organizationId, inArray(schema.mediaAsset.id, files)));
      }
    }

    // 2. Los chats de clientes pasan a la empresa.
    for (const c of clientes) {
      const [company] = await tx
        .select({ id: schema.conversation.id })
        .from(schema.conversation)
        .where(
          scoped(
            schema.conversation.organizationId,
            organizationId,
            eq(schema.conversation.contactId, c.contactId),
            isNull(schema.conversation.directNumberId),
            eq(schema.conversation.isTest, false)
          )
        )
        .limit(1);
      if (company) {
        await tx
          .update(schema.message)
          .set({ conversationId: company.id })
          .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.conversationId, c.id)));
        await tx
          .update(schema.conversation)
          .set({
            lastMessageAt: sql`greatest(${schema.conversation.lastMessageAt}, (select max(m.created_at) from message m where m.organization_id = ${organizationId} and m.conversation_id = ${company.id}))`,
            updatedAt: new Date(),
          })
          .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, company.id)));
        await tx.delete(schema.conversation).where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, c.id)));
      } else {
        await tx
          .update(schema.conversation)
          .set({ directNumberId: null, updatedAt: new Date() })
          .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, c.id)));
        await tx
          .delete(schema.conversationAccess)
          .where(scoped(schema.conversationAccess.organizationId, organizationId, eq(schema.conversationAccess.conversationId, c.id)));
      }
    }
    // Sus archivos dejan de ser «del número»: los ve quien ve el chat. Uno
    // que nunca se descargó ya no se puede pedir al dispositivo.
    if (clientes.length > 0) {
      await tx
        .update(schema.mediaAsset)
        .set({
          waMediaId: null,
          fetchStatus: sql`case when ${schema.mediaAsset.fetchStatus} = 'available' then 'available' else 'failed' end`,
          updatedAt: new Date(),
        })
        .where(scoped(schema.mediaAsset.organizationId, organizationId, like(schema.mediaAsset.waMediaId, marked)));
    }

    // 3. Contactos privados de este número.
    const contacts = await tx
      .select({ id: schema.contact.id })
      .from(schema.contact)
      .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.privateToNumberId, directNumberId)));
    let contactsDeleted = 0;
    for (const ct of contacts) {
      const [other] = await tx
        .select({ directNumberId: schema.conversation.directNumberId })
        .from(schema.conversation)
        .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.contactId, ct.id)))
        .orderBy(sql`${schema.conversation.directNumberId} is null desc`)
        .limit(1);
      if (!other) {
        await tx.delete(schema.contact).where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, ct.id)));
        contactsDeleted++;
      } else {
        // Sigue en otro número (privado de ese) o ya en la empresa (deja de ser privado).
        await tx
          .update(schema.contact)
          .set({ privateToNumberId: other.directNumberId, updatedAt: new Date() })
          .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, ct.id)));
      }
    }
    return {
      result: { kept: clientes.length, deleted: privados.length, contactsDeleted },
      filesToDelete: files,
    };
  });

  for (const id of filesToDelete) {
    await deleteMediaFile(organizationId, id).catch((err: unknown) =>
      log.warn("no se pudo borrar un archivo de un chat privado", { org: organizationId, asset: id, err })
    );
  }
  log.info("chats de un número dado de baja", { org: organizationId, number: directNumberId, ...result });
  return result;
}
