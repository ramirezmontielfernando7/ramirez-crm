/** Read-only shapes grounded in CRM 834806e. Does not perform requests. */
import { attachmentFromWire, type RemoteAttachment } from "./remote-media";
import { IntegrationError } from "./contracts";
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new IntegrationError("invalid");
  return v as Record<string, unknown>;
};
const id = (v: unknown) => {
  if (typeof v !== "string" || !v || v.length > 200)
    throw new IntegrationError("invalid");
  return v;
};
const timestamp = (v: unknown) => {
  const s = id(v);
  if (!Number.isFinite(Date.parse(s))) throw new IntegrationError("invalid");
  return s;
};
export type WireMessage = Readonly<{
  id: string;
  conversationId: string;
  direction: "in" | "out";
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  text: string | null;
  createdAt: string;
  aiGenerated: boolean;
  attachment?: RemoteAttachment;
  sender?: string;
  senderKey?: string;
  sticker?: boolean;
  reactions?: readonly { emoji: string; count: number }[];
  quote?: { messageId: string; title: string; preview: string };
}>;
export function messagesResponse(
  raw: unknown,
  conversationId: string,
): readonly WireMessage[] {
  const body = record(raw);
  if (!Array.isArray(body.messages)) throw new IntegrationError("invalid");
  return body.messages.map((x) => {
    const m = record(x);
    if (
      id(m.conversationId) !== conversationId ||
      !["in", "out"].includes(String(m.direction)) ||
      !["pending", "sent", "delivered", "read", "failed"].includes(
        String(m.status),
      ) ||
      !(m.text === null || typeof m.text === "string") ||
      typeof m.aiGenerated !== "boolean"
    )
      throw new IntegrationError("invalid");
    const attachment = attachmentFromWire(m.media);
    const media = m.media ? record(m.media) : undefined;
    const quote =
      m.quote && typeof m.quote === "object" && !Array.isArray(m.quote)
        ? record(m.quote)
        : undefined;
    const quoted =
      quote &&
      typeof quote.messageId === "string" &&
      /^[A-Za-z0-9_-]{1,200}$/.test(quote.messageId) &&
      typeof quote.title === "string" &&
      typeof quote.preview === "string"
        ? {
            messageId: quote.messageId,
            title: quote.title.slice(0, 100),
            preview: quote.preview.slice(0, 180),
          }
        : undefined;
    const reactions = Array.isArray(m.reactions)
      ? m.reactions.slice(0, 12).flatMap((value) => {
          if (!value || typeof value !== "object" || Array.isArray(value))
            return [];
          const { emoji, count } = record(value);
          return typeof emoji === "string" &&
            emoji.length <= 16 &&
            /\p{Extended_Pictographic}/u.test(emoji) &&
            typeof count === "number" &&
            Number.isSafeInteger(count) &&
            count > 0
            ? [{ emoji, count }]
            : [];
        })
      : [];
    return Object.freeze({
      ...(attachment
        ? {
            attachment,
            sticker: m.type === "sticker" || media?.kind === "sticker",
          }
        : {}),
      ...(quoted ? { quote: quoted } : {}),
      ...(reactions.length
        ? {
            reactions: [
              ...new Map(
                reactions.map((reaction) => [reaction.emoji, reaction]),
              ).values(),
            ],
          }
        : {}),
      ...(typeof m.groupSenderId === "string" && m.groupSenderId
        ? { senderKey: m.groupSenderId }
        : {}),
      ...(typeof m.groupSender === "string" && m.groupSender
        ? { sender: m.groupSender }
        : {}),
      id: id(m.id),
      conversationId,
      direction: m.direction as WireMessage["direction"],
      status: m.status as WireMessage["status"],
      text:
        (m.text as string | null) ??
        (typeof media?.caption === "string" ? media.caption : null),
      createdAt: timestamp(m.createdAt),
      aiGenerated: m.aiGenerated,
    });
  });
}
export type WireConversation = Readonly<{
  id: string;
  contact: Readonly<{ id: string; name: string; phone: string | null }>;
  channel?: string;
  waNumberId?: string;
  isGroup?: boolean;
  aiAvailable?: boolean;
  aiEnabled?: boolean;
  handoffAt?: string | null;
  assignee?: Readonly<{ id: string; name: string }>;
  unreadCount: number;
  preview?: string | null;
  lastMessageAt?: string | null;
  createdAt: string;
}>;
export function conversationsResponse(raw: unknown): {
  conversations: readonly WireConversation[];
  nextCursor: string | null;
} {
  const b = record(raw);
  if (
    !Array.isArray(b.conversations) ||
    !(b.nextCursor === null || typeof b.nextCursor === "string")
  )
    throw new IntegrationError("invalid");
  return {
    nextCursor: b.nextCursor as string | null,
    conversations: b.conversations.map((v) => {
      const c = record(v),
        contact = record(c.contact);
      if (
        typeof contact.name !== "string" ||
        !(contact.phone === null || typeof contact.phone === "string") ||
        !Number.isSafeInteger(c.unreadCount) ||
        (c.unreadCount as number) < 0
      )
        throw new IntegrationError("invalid");
      const assignee = c.assignee == null ? null : record(c.assignee);
      return Object.freeze({
        id: id(c.id),
        ...(typeof c.aiAvailable === "boolean"
          ? { aiAvailable: c.aiAvailable }
          : {}),
        ...(typeof c.aiEnabled === "boolean" ? { aiEnabled: c.aiEnabled } : {}),
        ...(typeof c.handoffAt === "string" || c.handoffAt === null
          ? { handoffAt: c.handoffAt }
          : {}),
        ...(typeof c.waNumberId === "string" && c.waNumberId
          ? { waNumberId: c.waNumberId }
          : {}),
        ...(typeof c.channel === "string" ? { channel: c.channel } : {}),
        ...(c.groupJid === null || typeof c.groupJid === "string"
          ? { isGroup: c.groupJid !== null }
          : {}),
        ...(assignee && typeof assignee.name === "string"
          ? { assignee: { id: id(assignee.id), name: assignee.name } }
          : {}),
        contact: Object.freeze({
          id: id(contact.id),
          name: contact.name,
          phone: contact.phone as string | null,
        }),
        unreadCount: c.unreadCount as number,
        ...(c.preview === null || typeof c.preview === "string"
          ? { preview: c.preview }
          : {}),
        ...(c.lastMessageAt === null || typeof c.lastMessageAt === "string"
          ? {
              lastMessageAt:
                c.lastMessageAt === null ? null : timestamp(c.lastMessageAt),
            }
          : {}),
        createdAt: timestamp(c.createdAt),
      });
    }),
  };
}
export function conversationRequest(
  filters: {
    q?: string;
    assigned?: string;
    status?: "all" | "unread" | "archived" | "humano" | "anuncios";
    stage?: string;
    tag?: string;
    channel?: "whatsapp" | "instagram" | "messenger";
    number?: string;
    cursor?: string;
    limit?: number;
  } = {},
) {
  const limit = filters.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new IntegrationError("invalid");
  const query = new URLSearchParams({ limit: String(limit) });
  for (const [k, v] of Object.entries(filters)) {
    if (k === "limit" || v === undefined) continue;
    if (typeof v !== "string" || v.length > (k === "q" ? 100 : 2000))
      throw new IntegrationError("invalid");
    query.set(k, v);
  }
  return { method: "GET" as const, path: `/api/conversations?${query}` };
}
export const currentApiLimits = Object.freeze({
  messageHistoryPagination: false,
  durableEventReplay: false,
  sendIdempotencyKey: false,
  recordCompareAndSwap: false,
  organizationPluginEnabled: false,
});
