import { eq, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import type { DeviceMessage } from "@/lib/direct-inbound";
import { openDirectTarget } from "@/server/credentials/direct-instance";
import { getOrCreateConversation, attachMediaAsset, mediaInputFrom, serializeMessage } from "@/server/inbox/ingest";
import { publish } from "@/server/events/bus";

/** Evolution owns group metadata; never use the participant's pushName as the title. */
async function groupSubject(organizationId: string, jid: string): Promise<string | null> {
  const opened = await openDirectTarget(organizationId);
  if (!opened.ok) return null;
  const { target } = opened;
  const url = `${target.baseUrl}/group/findGroupInfos/${encodeURIComponent(target.instanceName)}?groupJid=${encodeURIComponent(jid)}`;
  try {
    const response = await fetch(url, { headers: { apikey: target.apiKey }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const group = await response.json() as { subject?: unknown };
    return typeof group.subject === "string" && group.subject.trim() ? group.subject.slice(0, 200) : null;
  } catch { return null; }
}

/** Company groups reuse contacts, conversations, media and their RLS/role scopes.
 * No lead, campaign, opt-out keyword or automatic-agent side effects. */
export async function ingestGroupMessage(organizationId: string, m: DeviceMessage): Promise<void> {
  if (!m.group) return;
  const { jid, sender, senderId } = m.group;
  const db = getDb();
  const [existing] = await db.select().from(schema.contact)
    .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.waGroupJid, jid))).limit(1);
  const subject = m.group.subject ?? (!existing || existing.name === jid ? await groupSubject(organizationId, jid) : null);
  const [contact] = await db.insert(schema.contact).values({
    id: newId("contact"), organizationId, channel: "whatsapp", waIdentity: `group:${jid}`,
    waGroupJid: jid, name: subject ?? jid, phone: null,
  }).onConflictDoUpdate({
    target: [schema.contact.organizationId, schema.contact.channel, schema.contact.waIdentity],
    set: { waGroupJid: jid, ...(subject ? { name: subject } : {}) },
  }).returning();
  if (!contact) throw new Error("No se pudo resolver el grupo");
  const conversation = await getOrCreateConversation(organizationId, contact.id, { channel: "whatsapp" });
  const messageId = `direct.group.${organizationId}.${m.keyId}`;
  // The send response and the device echo may arrive in either order.
  const [echo] = m.fromMe ? await db.select({ id: schema.message.id }).from(schema.message)
    .where(scoped(schema.message.organizationId, organizationId,
      eq(schema.message.conversationId, conversation.id),
      or(eq(schema.message.altMessageId, m.keyId), eq(schema.message.waMessageId, messageId))))
    .limit(1) : [];
  if (echo) return;
  const timestamp = new Date(Number(m.timestamp) * 1000);
  const message = await db.transaction(async (tx) => {
    // This conversation can only ever use direct transport and manual replies.
    await tx.update(schema.conversation).set({ aiEnabled: false, connectionMode: "directa" })
      .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversation.id)));
    const [row] = await tx.insert(schema.message).values({
      id: newId("message"), organizationId, conversationId: conversation.id, waMessageId: messageId,
      altMessageId: m.keyId, direction: m.fromMe ? "out" : "in", origin: m.fromMe ? "manual" : "operator",
      type: m.message.type, text: m.message.text?.body ?? null, status: m.fromMe ? "sent" : "delivered",
      transport: "directa", waTimestamp: timestamp,
      groupSender: m.fromMe ? "Tú" : sender, groupSenderId: senderId,
    }).onConflictDoNothing({ target: schema.message.waMessageId }).returning();
    if (!row) return null;
    await tx.update(schema.conversation).set({
      lastMessageAt: sql`greatest(${schema.conversation.lastMessageAt}, ${timestamp.toISOString()}::timestamp)`,
      ...(!m.fromMe ? {
        lastInboundAt: sql`greatest(${schema.conversation.lastInboundAt}, ${timestamp.toISOString()}::timestamp)`,
        unreadCount: sql`${schema.conversation.unreadCount} + 1`, archivedAt: null,
      } : {}), updatedAt: new Date(),
    }).where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversation.id)));
    return row;
  });
  if (!message) return;
  const media = mediaInputFrom(m.message);
  const asset = media ? await attachMediaAsset(organizationId, message.id, media) : null;
  publish(organizationId, { type: "message.new", data: { conversationId: conversation.id, message: serializeMessage(message, asset) } });
  publish(organizationId, { type: "conversation.updated", data: { conversation: { id: conversation.id } } });
}
