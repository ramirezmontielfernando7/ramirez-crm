import type { WireMessage } from "./wire";

export type ChatStyle = "dashfort" | "whatsapp";
export const chatPageSize = 45;
export const latestThreshold = 72;

export function chatStyle(value: unknown): ChatStyle {
  return value === "dashfort" ? "dashfort" : "whatsapp";
}

export function newestMessages(
  previous: readonly WireMessage[],
  incoming: readonly WireMessage[],
) {
  const prior = new Map(previous.map((row) => [row.id, row]));
  return [...new Map(incoming.map((row) => [row.id, row])).values()]
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    )
    .map((row) => {
      const comparable = prior.get(row.id);
      return comparable && JSON.stringify(comparable) === JSON.stringify(row)
        ? comparable
        : row;
    });
}

export function timelineWindow(
  newest: readonly WireMessage[],
  limit: number,
  pinned: string | undefined,
) {
  const boundary = pinned ? newest.findIndex((row) => row.id === pinned) : 0;
  const hidden = Math.max(0, boundary);
  return { hidden, rows: newest.slice(hidden, hidden + limit) };
}

export function dayKey(time: string | Date) {
  const d = new Date(time);
  return [d.getFullYear(), d.getMonth(), d.getDate()].join("-");
}

export function dayLabel(time: string, now = new Date()) {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(time) === dayKey(now)) return "Hoy";
  if (dayKey(time) === dayKey(yesterday)) return "Ayer";
  return new Date(time).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function followsSameSender(a: WireMessage, b: WireMessage | undefined) {
  return Boolean(
    b &&
    a.direction === b.direction &&
    a.aiGenerated === b.aiGenerated &&
    (a.senderKey ?? a.sender) === (b.senderKey ?? b.sender) &&
    dayKey(a.createdAt) === dayKey(b.createdAt),
  );
}
