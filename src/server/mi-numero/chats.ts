import { desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { logger } from "@/lib/log";
import { assignContacts } from "@/server/assignment/assign";
import { publish } from "@/server/events/bus";
import { serializeMessage } from "@/server/inbox/ingest";
import { createLeadForContact } from "@/server/inbox/lead-activity";
import { syncNumberAi } from "./ai";
import { numberAudience } from "./audience";
import { MiNumeroFailure } from "./numbers";
import { supervisedNumberAsset } from "./supervise";

const log = logger("mi-numero");

/**
 * Mi número (046), PR 4 — Los chats de MI número: solo su dueño los lista,
 * los abre y marca «Es cliente». Todo se decide por la sesión (el número
 * vivo de quien pide); jamás por un id que mande el navegador. Ver los chats
 * de otro con su permiso es del PR 6.
 *
 * Estas consultas usan `scoped()` con el número de quien pide, a propósito:
 * `scopedContacts()` esconde los chats de los números (aislado por defecto).
 */

type NumberRow = typeof schema.directNumber.$inferSelect;

async function myLiveNumber(organizationId: string, userId: string): Promise<NumberRow> {
  const [row] = await getDb()
    .select()
    .from(schema.directNumber)
    .where(
      scoped(
        schema.directNumber.organizationId,
        organizationId,
        eq(schema.directNumber.userId, userId),
        isNull(schema.directNumber.revokedAt)
      )
    )
    .limit(1);
  if (!row) throw new MiNumeroFailure("not_found");
  return row;
}

export type MyChatDto = {
  id: string;
  contact: { id: string; name: string; phone: string | null; inCrm: boolean };
  preview: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  clientMarkedAt: string | null;
  /** PR 8: la IA en este chat: contesta, en pausa, o no aplica (privado o interruptor apagado). */
  ai: "on" | "paused" | null;
};

export type MyChats = { numberId: string; shareClients: boolean; chats: MyChatDto[] };

export async function listMyChats(organizationId: string, userId: string): Promise<MyChats> {
  const number = await myLiveNumber(organizationId, userId);
  const preview = sql<string | null>`(
    select coalesce(m.text, m.type) from message m
    where m.organization_id = ${organizationId} and m.conversation_id = ${schema.conversation.id}
    order by m.created_at desc limit 1
  )`;
  const rows = await getDb()
    .select({ conversation: schema.conversation, contact: schema.contact, preview })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.directNumberId, number.id),
        isNull(schema.conversation.archivedAt)
      )
    )
    .orderBy(desc(sql`coalesce(${schema.conversation.lastMessageAt}, ${schema.conversation.createdAt})`));
  return {
    numberId: number.id,
    shareClients: number.shareClients,
    chats: rows.map((r) => ({
      id: r.conversation.id,
      contact: {
        id: r.contact.id,
        name: r.contact.name,
        phone: r.contact.phone,
        inCrm: r.contact.privateToNumberId === null,
      },
      preview: r.preview,
      unreadCount: r.conversation.unreadCount,
      lastMessageAt: r.conversation.lastMessageAt?.toISOString() ?? null,
      clientMarkedAt: r.conversation.clientMarkedAt?.toISOString() ?? null,
      ai: aiStateOf(number, r.conversation),
    })),
  };
}

function aiStateOf(
  number: Pick<NumberRow, "aiReplies">,
  conversation: Pick<typeof schema.conversation.$inferSelect, "clientMarkedAt" | "aiEnabled" | "handoffAt">
): MyChatDto["ai"] {
  if (!number.aiReplies || !conversation.clientMarkedAt || !conversation.aiEnabled) return null;
  return conversation.handoffAt ? "paused" : "on";
}

/**
 * PR 8: la persona pausa o reanuda la IA en uno de SUS chats. Reanudar solo
 * donde la IA aplica (chat de cliente con «La IA contesta mis chats»).
 */
export async function setChatAi(organizationId: string, userId: string, conversationId: string, on: boolean): Promise<void> {
  const { number, conversation } = await myChat(organizationId, userId, conversationId);
  if (on && aiStateOf(number, conversation) === null) throw new MiNumeroFailure("ai_off");
  await getDb()
    .update(schema.conversation)
    .set(on ? { handoffAt: null, handoffReason: null, updatedAt: new Date() } : { handoffAt: conversation.handoffAt ?? new Date(), handoffReason: conversation.handoffReason ?? "manual_reply", updatedAt: new Date() })
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversation.id)));
  publish(organizationId, { type: "number.conversation", data: { conversationId: conversation.id }, audience: await numberAudience(organizationId, number) });
}

export async function myChat(organizationId: string, userId: string, conversationId: string) {
  const number = await myLiveNumber(organizationId, userId);
  const [conversation] = await getDb()
    .select()
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId),
        eq(schema.conversation.directNumberId, number.id)
      )
    )
    .limit(1);
  if (!conversation) throw new MiNumeroFailure("not_found");
  return { number, conversation };
}

/** Los mensajes de uno de MIS chats; abrirlo lo deja leído. */
export async function myChatMessages(organizationId: string, userId: string, conversationId: string) {
  const { number, conversation } = await myChat(organizationId, userId, conversationId);
  const db = getDb();
  const rows = await db
    .select({ message: schema.message, media: schema.mediaAsset })
    .from(schema.message)
    .leftJoin(schema.mediaAsset, eq(schema.message.mediaAssetId, schema.mediaAsset.id))
    .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.conversationId, conversation.id)))
    .orderBy(schema.message.createdAt);
  if (conversation.unreadCount > 0) {
    await db
      .update(schema.conversation)
      .set({ unreadCount: 0 })
      .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversation.id)));
    publish(organizationId, { type: "number.conversation", data: { conversationId: conversation.id }, audience: await numberAudience(organizationId, number) });
  }
  return rows.map((r) => serializeMessage(r.message, r.media));
}

/**
 * «Es cliente»: el chat pasa al CRM. Solo con «Compartir mis clientes» encendido.
 * - El contacto deja de ser privado (aparece en Contactos y en el embudo).
 * - Si nadie lo atiende, queda asignado a la persona; su lead entra en la
 *   primera etapa abierta (o se queda el que ya tenía).
 * - El chat sigue en su número: verlo es del dueño (y, con su permiso, PR 6).
 */
export async function markClient(organizationId: string, userId: string, conversationId: string): Promise<void> {
  const { number, conversation } = await myChat(organizationId, userId, conversationId);
  if (!number.shareClients) throw new MiNumeroFailure("share_off");
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.conversation)
    .set({ clientMarkedAt: conversation.clientMarkedAt ?? now, clientMarkedBy: conversation.clientMarkedBy ?? userId, updatedAt: now })
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversation.id)));
  const [contact] = await db
    .select()
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, conversation.contactId)))
    .limit(1);
  if (!contact) return;
  if (contact.privateToNumberId) {
    await db
      .update(schema.contact)
      .set({ privateToNumberId: null, updatedAt: now })
      .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contact.id)));
  }
  if (!contact.assignedUserId) {
    const r = await assignContacts({
      organizationId,
      contactIds: [contact.id],
      toUserId: userId,
      actorUserId: userId,
      source: "manual",
      reason: "Es cliente (Mi número)",
    });
    if (!r.ok) log.warn("no se pudo asignar el cliente marcado", { org: organizationId, reason: r.reason });
  }
  await createLeadForContact({ organizationId, contactId: contact.id, at: now, source: "dueno", actorUserId: userId });
  // PR 8: si «La IA contesta mis chats» está encendido, desde ahora contesta aquí.
  await syncNumberAi(organizationId, number.id);
  publish(organizationId, { type: "number.conversation", data: { conversationId: conversation.id }, audience: await numberAudience(organizationId, number) });
}

/**
 * Un adjunto de uno de MIS chats, o (PR 6) de un chat que su dueño me dejó
 * leer, o (PR 7) de un número de la empresa que superviso (para servirlo);
 * null si no.
 */
export async function myNumberAsset(organizationId: string, userId: string, assetId: string) {
  return (
    (await ownNumberAsset(organizationId, userId, assetId)) ??
    (await sharedNumberAsset(organizationId, userId, assetId)) ??
    // PR 7: de un número de la empresa, para quien supervisa.
    (await supervisedNumberAsset(organizationId, userId, assetId))
  );
}

async function sharedNumberAsset(organizationId: string, userId: string, assetId: string) {
  const [row] = await getDb()
    .select({ asset: schema.mediaAsset })
    .from(schema.mediaAsset)
    .innerJoin(schema.message, eq(schema.message.mediaAssetId, schema.mediaAsset.id))
    .innerJoin(schema.conversationAccess, eq(schema.conversationAccess.conversationId, schema.message.conversationId))
    .where(
      scoped(
        schema.mediaAsset.organizationId,
        organizationId,
        eq(schema.mediaAsset.id, assetId),
        eq(schema.conversationAccess.userId, userId),
        eq(schema.conversationAccess.status, "granted")
      )
    )
    .limit(1);
  return row?.asset ?? null;
}

async function ownNumberAsset(organizationId: string, userId: string, assetId: string) {
  const [number] = await getDb()
    .select({ id: schema.directNumber.id })
    .from(schema.directNumber)
    .where(
      scoped(
        schema.directNumber.organizationId,
        organizationId,
        eq(schema.directNumber.userId, userId),
        isNull(schema.directNumber.revokedAt)
      )
    )
    .limit(1);
  if (!number) return null;
  const [row] = await getDb()
    .select({ asset: schema.mediaAsset })
    .from(schema.mediaAsset)
    .innerJoin(schema.message, eq(schema.message.mediaAssetId, schema.mediaAsset.id))
    .innerJoin(schema.conversation, eq(schema.conversation.id, schema.message.conversationId))
    .where(
      scoped(
        schema.mediaAsset.organizationId,
        organizationId,
        eq(schema.mediaAsset.id, assetId),
        eq(schema.conversation.directNumberId, number.id)
      )
    )
    .limit(1);
  return row?.asset ?? null;
}
