import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped, type Access } from "@/lib/db/tenant";
import type { ConversationDto } from "@/lib/types";
import { logger } from "@/lib/log";
import { assignContacts } from "@/server/assignment/assign";
import { publish } from "@/server/events/bus";
import { serializeMessage } from "@/server/inbox/ingest";
import { createLeadForContact } from "@/server/inbox/lead-activity";
import { numberClientChats } from "@/server/inbox/queries";
import { normalizeTypedPhone } from "@/lib/phone-search";
import { getOrCreateContactByIdentity } from "@/server/inbox/identity";
import { numberConversation } from "./conversation";
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
  /** La persona ya contestó «No» a «¿Es cliente?» en este chat: la barra no sale. */
  clientAsked: boolean;
  /** PR 8: la IA en este chat: contesta, en pausa, o no aplica (privado o interruptor apagado). */
  ai: "on" | "paused" | null;
  /**
   * Lo de CRM del chat (etapa, etiquetas, quién atiende), igual que en la
   * Bandeja de la empresa. Solo en chats de cliente cuyo contacto puede ver
   * quien pide; null en los privados.
   */
  crm: ConversationDto | null;
};

export type MyChats = { numberId: string; shareClients: boolean; chats: MyChatDto[] };

export async function listMyChats(
  organizationId: string,
  userId: string,
  // Lo que la sesión ve del CRM (para `crm`); sin él, como un asesor.
  access: Access = { organizationId, userId, seesAll: false }
): Promise<MyChats> {
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
  const crm = new Map(
    (await numberClientChats(access, rows.filter((r) => r.conversation.clientMarkedAt).map((r) => r.conversation.id))).map((c) => [c.id, c])
  );
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
      clientAsked: r.conversation.clientPromptDismissedAt !== null,
      ai: aiStateOf(number, r.conversation),
      crm: crm.get(r.conversation.id) ?? null,
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
  await applyClientMark(number, conversation, userId);
}

/**
 * El cuerpo de «Es cliente», también para los chats que nacen ya como cliente
 * (`clientByDefault`): quien llama decidió que corresponde.
 */
export async function applyClientMark(
  number: NumberRow,
  conversation: typeof schema.conversation.$inferSelect,
  userId: string
): Promise<void> {
  const { organizationId } = number;
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.conversation)
    .set({
      clientMarkedAt: conversation.clientMarkedAt ?? now,
      clientMarkedBy: conversation.clientMarkedBy ?? userId,
      clientPromptDismissedAt: null,
      updatedAt: now,
    })
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

/** Un chat recién nacido: con «Marcar chats nuevos como cliente por defecto» (y «Compartir mis clientes») nace como cliente. */
export async function applyNewChatDefault(
  number: NumberRow,
  conversation: typeof schema.conversation.$inferSelect
): Promise<typeof schema.conversation.$inferSelect> {
  if (!number.shareClients || !number.clientByDefault) return conversation;
  await applyClientMark(number, conversation, number.userId);
  const [fresh] = await getDb()
    .select()
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, number.organizationId, eq(schema.conversation.id, conversation.id)))
    .limit(1);
  return fresh ?? conversation;
}

/**
 * «No es cliente»: el chat vuelve a ser privado. NO se borra nada: la etapa, las
 * etiquetas, la ficha y el lead se quedan guardados (escondidos mientras el
 * contacto sea privado) y reaparecen si se vuelve a marcar.
 * - Si el contacto tiene otro chat vivo (p. ej. con la empresa), sigue en el
 *   CRM; solo este chat deja de ser de cliente.
 * - Se quitan los permisos de ver este chat que otros tenían o pedían.
 * - La IA deja de contestar aquí.
 */
export async function unmarkClient(organizationId: string, userId: string, conversationId: string): Promise<void> {
  const { number, conversation } = await myChat(organizationId, userId, conversationId);
  if (!conversation.clientMarkedAt) return;
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.conversation)
    .set({ clientMarkedAt: null, clientMarkedBy: null, clientPromptDismissedAt: now, updatedAt: now })
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversation.id)));
  await db
    .update(schema.conversationAccess)
    .set({ status: "revoked" })
    .where(
      scoped(
        schema.conversationAccess.organizationId,
        organizationId,
        eq(schema.conversationAccess.conversationId, conversation.id),
        inArray(schema.conversationAccess.status, ["pending", "granted"])
      )
    );
  const [other] = await db
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        and(
          eq(schema.conversation.contactId, conversation.contactId),
          ne(schema.conversation.id, conversation.id),
          isNull(schema.conversation.archivedAt)
        )
      )
    )
    .limit(1);
  if (!other) {
    await db
      .update(schema.contact)
      .set({ privateToNumberId: number.id, updatedAt: now })
      .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, conversation.contactId)));
  }
  await syncNumberAi(organizationId, number.id);
  publish(organizationId, { type: "number.conversation", data: { conversationId: conversation.id }, audience: await numberAudience(organizationId, number) });
}

/** «¿Es cliente?» → «No»: solo esconde la pregunta en este chat; no cambia nada más. */
export async function dismissClientPrompt(organizationId: string, userId: string, conversationId: string): Promise<void> {
  const { conversation } = await myChat(organizationId, userId, conversationId);
  await getDb()
    .update(schema.conversation)
    .set({ clientPromptDismissedAt: new Date() })
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversation.id)));
}

/**
 * Buscar un teléfono nuevo y abrir su chat: el contacto (si no existe) nace
 * PRIVADO de este número, igual que cuando alguien escribe primero. Con
 * «Marcar chats nuevos como cliente por defecto» el chat nace como cliente.
 */
export async function openNumberChat(
  organizationId: string,
  userId: string,
  input: { phone: string; name?: string }
): Promise<{ conversationId: string }> {
  const number = await myLiveNumber(organizationId, userId);
  const typed = normalizeTypedPhone(input.phone);
  if (!typed.valid) throw new MiNumeroFailure("bad_phone");
  const { contact, isNew } = await getOrCreateContactByIdentity(
    organizationId,
    { identity: typed.phone, phone: typed.phone, waUserId: null, profileName: input.name?.trim() || null },
    { privateTo: number.id }
  );
  const name = input.name?.trim();
  if (name && (isNew || contact.nameSource === "perfil") && name !== contact.name) {
    await getDb()
      .update(schema.contact)
      .set({ name, nameSource: "manual", updatedAt: new Date() })
      .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contact.id)));
  }
  const { conversation, created } = await numberConversation(organizationId, number.id, contact.id);
  if (created) await applyNewChatDefault(number, conversation);
  return { conversationId: conversation.id };
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
