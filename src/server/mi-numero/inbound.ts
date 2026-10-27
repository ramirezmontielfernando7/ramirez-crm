import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { numberMediaId, numberMessageId, type DeviceMessage } from "@/lib/direct-inbound";
import { logger } from "@/lib/log";
import { runWithOrganization } from "@/lib/request-context";
import { phoneByLid } from "@/server/direct-connection/inbound";
import { publish } from "@/server/events/bus";
import { getOrCreateContactByIdentity } from "@/server/inbox/identity";
import { attachMediaAsset, mediaInputFrom, serializeMessage } from "@/server/inbox/ingest";
import { getOrgModules } from "@/server/modules";
import { isOrgActive } from "@/server/platform-admin/org-status";
import { audienceOf } from "./chats";

const log = logger("mi-numero");

/**
 * Mi número (046), PR 4 — Lo que ENTRA (y lo que la persona escribe en su
 * celular) por el dispositivo vinculado de un «Mi número».
 *
 * - Va al chat de ESE número con el cliente (uno por número y contacto),
 *   nunca al de la empresa. Un contacto que ya existe se usa (una sola
 *   ficha); uno nuevo nace PRIVADO del número (fuera del CRM).
 * - Nada de lo de la empresa: ni lead, ni reparto, ni bajas, ni IA, ni
 *   campañas. Solo el dueño se entera (eventos con su audiencia).
 * - Idempotente: `wa_message_id` = `direct.<número>.<key.id>`. Lo que
 *   Dashfort envió por el número (PR 5) no vuelve a entrar como `fromMe`.
 * - Un número revocado, un complemento apagado o una organización no activa:
 *   se descarta (el webhook ya respondió 200).
 */
export async function ingestNumberMessages(
  ref: { organizationId: string; directNumberId: string },
  messages: DeviceMessage[]
): Promise<number> {
  if (messages.length === 0) return 0;
  const { organizationId, directNumberId } = ref;
  return runWithOrganization(organizationId, async () => {
    let number: typeof schema.directNumber.$inferSelect | undefined;
    try {
      if (!(await isOrgActive(organizationId)) || !(await getOrgModules(organizationId)).miNumero) return 0;
      [number] = await getDb()
        .select()
        .from(schema.directNumber)
        .where(scoped(schema.directNumber.organizationId, organizationId, eq(schema.directNumber.id, directNumberId)))
        .limit(1);
    } catch (err) {
      log.error("no se pudo revisar el número del dispositivo vinculado", { org: organizationId, number: directNumberId, err });
      return 0;
    }
    if (!number || number.revokedAt) return 0;
    let done = 0;
    for (const m of messages) {
      try {
        if (await ingestOne(number, m)) done++;
      } catch (err) {
        log.error("no se pudo registrar un mensaje de un «Mi número»", { org: organizationId, number: directNumberId, err });
      }
    }
    return done;
  });
}

type NumberRow = typeof schema.directNumber.$inferSelect;

async function ingestOne(number: NumberRow, m: DeviceMessage): Promise<boolean> {
  const { organizationId } = number;
  const db = getDb();
  const phone = m.phone ?? (m.lid ? await phoneByLid(organizationId, m.lid) : null);
  if (!phone) {
    log.warn("mensaje de un «Mi número» sin teléfono del contacto: descartado", { org: organizationId, number: number.id });
    return false;
  }
  const { contact } = await getOrCreateContactByIdentity(
    organizationId,
    { identity: phone, phone, waUserId: null, profileName: m.fromMe ? null : m.pushName },
    { privateTo: number.id }
  );
  if (m.lid && !contact.waLid) {
    await db
      .update(schema.contact)
      .set({ waLid: m.lid })
      .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contact.id)))
      .catch((err: unknown) => log.warn("no se guardó el ID privado del contacto", { org: organizationId, err }));
  }
  const conversation = await numberConversation(organizationId, number.id, contact.id);
  const at = new Date(Number(m.timestamp) * 1000 || Date.now());

  // PR 5: lo que Dashfort mandó por este número vuelve como `fromMe` con el
  // mismo ID del dispositivo: ya está en el hilo, no se registra otra vez.
  if (m.fromMe) {
    const [own] = await db
      .select({ id: schema.message.id })
      .from(schema.message)
      .where(
        scoped(
          schema.message.organizationId,
          organizationId,
          eq(schema.message.conversationId, conversation.id),
          eq(schema.message.altMessageId, m.keyId),
          eq(schema.message.direction, "out"),
          isNull(schema.message.waMessageId)
        )
      )
      .limit(1);
    if (own) return false;
  }

  const [message] = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      waMessageId: numberMessageId(number.id, m.keyId),
      direction: m.fromMe ? "out" : "in",
      type: m.message.type,
      text: m.message.text?.body ?? null,
      status: m.fromMe ? "sent" : "delivered",
      ...(m.fromMe ? { origin: "manual" as const } : {}),
      waTimestamp: at,
      transport: "directa",
      altMessageId: m.keyId,
    })
    .onConflictDoNothing({ target: [schema.message.waMessageId] })
    .returning();
  if (!message) return false; // duplicado

  const media = mediaInputFrom(m.message);
  const asset = media
    ? await attachMediaAsset(organizationId, message.id, media.waMediaId ? { ...media, waMediaId: numberMediaId(number.id, m.keyId) } : media)
    : null;

  await db
    .update(schema.conversation)
    .set(
      m.fromMe
        ? { lastMessageAt: at, updatedAt: new Date() }
        : {
            lastInboundAt: at,
            lastMessageAt: at,
            unreadCount: sql`${schema.conversation.unreadCount} + 1`,
            archivedAt: null,
            updatedAt: new Date(),
          }
    )
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversation.id)));

  const audience = audienceOf(number);
  publish(organizationId, {
    type: "number.message",
    data: { conversationId: conversation.id, message: serializeMessage(message, asset) },
    audience,
  });
  publish(organizationId, { type: "number.conversation", data: { conversationId: conversation.id }, audience });
  return true;
}

/** El chat de este número con este contacto (uno solo; la IA nace apagada). */
async function numberConversation(organizationId: string, directNumberId: string, contactId: string) {
  const db = getDb();
  const [created] = await db
    .insert(schema.conversation)
    .values({ id: newId("conversation"), organizationId, contactId, directNumberId, aiEnabled: false })
    .onConflictDoNothing({
      target: [schema.conversation.organizationId, schema.conversation.directNumberId, schema.conversation.contactId],
      where: isNotNull(schema.conversation.directNumberId),
    })
    .returning();
  if (created) return created;
  const [existing] = await db
    .select()
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        and(eq(schema.conversation.directNumberId, directNumberId), eq(schema.conversation.contactId, contactId))
      )
    )
    .limit(1);
  if (!existing) throw new Error("chat del número no encontrado tras upsert");
  return existing;
}
