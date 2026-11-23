import { crmRecord, isRemoteId } from "./remote-crm-contract";
import { IntegrationError } from "./contracts";
import { messagesResponse, type WireMessage } from "./wire";

const idPattern = "[A-Za-z0-9_-]{1,64}";
const teamHistory = new RegExp(
  `^/api/team-chat/threads/${idPattern}/messages$`,
);
const pagedHistory = new RegExp(
  `^/api/(?:team-chat/threads|my-number/chats)/${idPattern}/messages(?:\\?before=${idPattern})?$`,
);

export function allowsInboxAreaRequest(
  method: string,
  path: string,
  writes: boolean,
) {
  if (method === "GET")
    return (
      path === "/api/team-chat/threads" ||
      path === "/api/settings/my-number" ||
      path === "/api/my-number/chats" ||
      pagedHistory.test(path)
    );
  return method === "POST" && writes && teamHistory.test(path);
}

export function inboxAreaId(value: unknown) {
  if (!isRemoteId(value) || value.length > 64)
    throw new IntegrationError("invalid");
  return value;
}

export function inboxHistoryPath(
  area: "team" | "number",
  id: string,
  before?: string,
) {
  const resource = area === "team" ? "team-chat/threads" : "my-number/chats";
  return (
    `/api/${resource}/${inboxAreaId(id)}/messages` +
    (before === undefined ? "" : `?before=${inboxAreaId(before)}`)
  );
}

export type AreaRow = {
  id: string;
  name: string;
  preview: string;
  unread: number;
  supervised?: boolean;
};
function crmArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new IntegrationError("invalid");
  return value;
}

const badge = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 0;
const plain = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

export function teamThreads(raw: unknown): AreaRow[] {
  return crmArray(crmRecord(raw).threads).map((item) => {
    const thread = crmRecord(item);
    return {
      id: inboxAreaId(thread.id),
      name: plain(thread.title, "Conversación de equipo"),
      preview: plain(thread.lastMessagePreview),
      unread: badge(thread.unread),
      supervised: thread.relation === "oversight",
    };
  });
}

export function connectedOwnNumber(raw: unknown) {
  const { number } = crmRecord(raw);
  if (number === null) return null;
  const own = crmRecord(number);
  if (crmRecord(own.connection).status !== "connected") return null;
  return inboxAreaId(own.id);
}

export function ownNumberChats(raw: unknown, ownId: string): AreaRow[] {
  const body = crmRecord(raw);
  if (body.numberId !== ownId) throw new IntegrationError("invalid");
  return crmArray(body.chats).map((item) => {
    const chat = crmRecord(item);
    return {
      id: inboxAreaId(chat.id),
      name: plain(crmRecord(chat.contact).name, "Chat de mi número"),
      preview: plain(chat.preview),
      unread: badge(chat.unreadCount),
    };
  });
}

export function areaHistory(raw: unknown, area: "team" | "number", id: string) {
  const body = crmRecord(raw);
  if (area === "number")
    return {
      messages: messagesResponse(body, id),
      more: body.more === true,
      canPost: false,
    };
  const messages: WireMessage[] = crmArray(body.messages).map((entry) => {
    const msg = crmRecord(entry);
    if (
      msg.threadId !== id ||
      !Number.isFinite(Date.parse(String(msg.createdAt)))
    )
      throw new IntegrationError("invalid");
    const sender = msg.author
      ? plain(crmRecord(msg.author).name, "Equipo")
      : "Equipo";
    const deleted = msg.deleted === true;
    const reactions = new Map<string, number>();
    if (!deleted && Array.isArray(msg.reactions)) {
      for (const value of msg.reactions) {
        const { emoji, userIds } = crmRecord(value);
        if (
          typeof emoji === "string" &&
          emoji.length <= 16 &&
          /\p{Extended_Pictographic}/u.test(emoji) &&
          Array.isArray(userIds)
        )
          reactions.set(
            emoji,
            new Set(userIds.filter((v) => typeof v === "string")).size,
          );
      }
    }
    return {
      id: inboxAreaId(msg.id),
      conversationId: id,
      createdAt: String(msg.createdAt),
      sender,
      ...(msg.author && typeof crmRecord(msg.author).id === "string"
        ? { senderKey: String(crmRecord(msg.author).id) }
        : {}),
      direction: "in",
      status: "sent",
      text: deleted
        ? "Mensaje eliminado"
        : plain(msg.body) ||
          (msg.attachment ? "Adjunto · Disponible en la versión web" : ""),
      aiGenerated: false,
      reactions: [...reactions].map(([emoji, count]) => ({ emoji, count })),
    };
  });
  return {
    messages,
    more: body.hasMore === true,
    canPost: body.relation === "member" && body.canPost === true,
  };
}
