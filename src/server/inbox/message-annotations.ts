import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb, schema, withTenant } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { companyChat, scoped, scopedConversations, type Access } from "@/lib/db/tenant";
import { quotePreview, validCustomerReaction } from "@/lib/customer-message-annotations";
import type { CustomerReactionDto, MessageReplyDto } from "@/lib/types";
import { publish } from "@/server/events/bus";
import type { ResolvedIdentity } from "./identity";

const messages = schema.message;
const reactions = schema.messageReaction;

type Destination = { organizationId: string; conversationId: string; messageId: string };

export async function messageById(access: Access, conversationId: string, id: string) {
  const [row] = await getDb().select({
    id: messages.id,
    waMessageId: messages.waMessageId,
    transport: messages.transport,
  }).from(messages).where(scopedConversations(
    messages.organizationId, access, messages.conversationId,
    eq(messages.conversationId, conversationId), eq(messages.id, id),
  )).limit(1);
  return row;
}

export async function annotations(
  access: Access,
  conversationId: string,
  page: readonly { id: string; replyToWaMessageId: string | null }[],
) {
  const visibleReactions = new Map<string, CustomerReactionDto[]>();
  const quoted = new Map<string, MessageReplyDto>();
  if (!page.length) return { visibleReactions, quoted };
  const replyIds = [...new Set(page.flatMap((m) => m.replyToWaMessageId ? [m.replyToWaMessageId] : []))];
  // Query by conversation to avoid a parameter per historical message.
  const [active, replies] = await Promise.all([
    getDb().select({ messageId: reactions.messageId, direction: reactions.direction, emoji: reactions.emoji })
      .from(reactions).where(scopedConversations(
        reactions.organizationId, access, reactions.conversationId,
        eq(reactions.conversationId, conversationId), ne(reactions.emoji, ""),
      )).orderBy(reactions.direction),
    replyIds.length ? getDb().select({
      id: messages.id, direction: messages.direction, type: messages.type,
      text: messages.text, waMessageId: messages.waMessageId,
    }).from(messages).where(scopedConversations(
      messages.organizationId, access, messages.conversationId,
      eq(messages.conversationId, conversationId), inArray(messages.waMessageId, replyIds),
    )) : Promise.resolve([]),
  ]);
  for (const { messageId, direction, emoji } of active) {
    const list = visibleReactions.get(messageId) ?? [];
    list.push({ direction, emoji });
    visibleReactions.set(messageId, list);
  }
  for (const row of replies) {
    if (row.waMessageId) quoted.set(row.waMessageId, {
      id: row.id, direction: row.direction, type: row.type, preview: quotePreview(row.text, row.type),
    });
  }
  return { visibleReactions, quoted };
}

function hint({ organizationId, conversationId, messageId }: Destination) {
  publish(organizationId, { type: "message.reaction", data: { conversationId, messageId } });
}

export async function ingestCustomerReaction(input: {
  organizationId: string; waPhoneNumberId: string; identity: ResolvedIdentity;
  eventId: string; target: string; emoji: string; timestamp: string;
}) {
  const { organizationId, identity, eventId, target, emoji } = input;
  const eventAt = new Date(Number(input.timestamp) * 1000);
  if (![eventId, target].every((v) => typeof v === "string" && v.length > 0 && v.length <= 512) ||
      typeof emoji !== "string" || !validCustomerReaction(emoji) ||
      !input.timestamp || !Number.isFinite(eventAt.getTime())) return;

  const contact = schema.contact;
  const chat = schema.conversation;
  const change = await withTenant(organizationId, async (tx) => {
    const [row] = await tx.select({ messageId: messages.id, conversationId: messages.conversationId })
      .from(messages)
      .innerJoin(chat, sql`${chat.id} = ${messages.conversationId} AND ${chat.organizationId} = ${messages.organizationId}`)
      .innerJoin(contact, sql`${contact.id} = ${chat.contactId} AND ${contact.organizationId} = ${chat.organizationId}`)
      .where(scoped(messages.organizationId, organizationId,
        eq(messages.waMessageId, target), eq(chat.channel, "whatsapp"), companyChat(),
        isNull(contact.privateToNumberId), isNull(contact.waGroupJid),
        or(isNull(chat.waPhoneNumberId), eq(chat.waPhoneNumberId, input.waPhoneNumberId)),
        or(eq(contact.waIdentity, identity.identity),
          identity.waUserId ? eq(contact.waUserId, identity.waUserId) : undefined,
          identity.phone ? eq(contact.phone, identity.phone) : undefined),
      )).limit(1);
    if (!row) return null;
    const key = scoped(reactions.organizationId, organizationId, eq(reactions.messageId, row.messageId), eq(reactions.direction, "in"));
    await tx.insert(reactions).values({
      ...row, id: newId("messageReaction"), organizationId, direction: "in", emoji: "",
    }).onConflictDoNothing({ target: [reactions.messageId, reactions.direction] });
    const [previous] = await tx.select().from(reactions).where(key).for("update");
    if (!previous || previous.seenWaIds.includes(eventId) || (previous.eventAt && previous.eventAt > eventAt)) return null;
    await tx.update(reactions).set({
      emoji, eventAt, waReactionMessageId: eventId, updatedAt: new Date(),
      // Only events sharing the latest timestamp can arrive again and still apply.
      seenWaIds: previous.eventAt?.getTime() === eventAt.getTime() ? [...previous.seenWaIds, eventId] : [eventId],
    }).where(key);
    return previous.emoji === emoji ? null : { organizationId, ...row };
  });
  if (change) hint(change);
}

function outKey(dest: Destination) {
  return scoped(reactions.organizationId, dest.organizationId,
    eq(reactions.conversationId, dest.conversationId), eq(reactions.messageId, dest.messageId), eq(reactions.direction, "out"));
}

export async function reserveReaction(dest: Destination, emoji: string) {
  return withTenant(dest.organizationId, async (tx) => {
    await tx.insert(reactions).values({
      ...dest, id: newId("messageReaction"), direction: "out", emoji: "",
    }).onConflictDoNothing({ target: [reactions.messageId, reactions.direction] });
    const key = outKey(dest);
    const [row] = await tx.select().from(reactions).where(key).for("update");
    if (!row) return { kind: "pending" as const };
    const now = new Date();
    if (row.pendingAt && now.getTime() - row.pendingAt.getTime() < 120_000) return { kind: "pending" as const };
    if (!row.pendingAt && row.emoji === emoji) return { kind: "unchanged" as const };
    await tx.update(reactions).set({ pendingEmoji: emoji, pendingAt: now }).where(key);
    return { kind: "reserved" as const, at: now };
  });
}

export async function finishReaction(dest: Destination, at: Date, result?: { emoji: string; waId: string }) {
  const [row] = await getDb().update(reactions).set({
    pendingEmoji: null, pendingAt: null,
    ...(result ? { emoji: result.emoji, waReactionMessageId: result.waId, updatedAt: new Date() } : {}),
  }).where(and(outKey(dest), eq(reactions.pendingAt, at))).returning({ id: reactions.id });
  if (row && result) hint(dest);
}
