import type { Role } from "../../domain/access";
export const ORG_A = "demo-org-a",
  ORG_B = "demo-org-b";
export const kinds = [
  "message.incoming",
  "handoff",
  "message.outgoing",
  "status",
  "note",
  "ai",
] as const;
export type Kind = (typeof kinds)[number];
export type Permission = "granted" | "denied" | "revoked";
export type Identity = Readonly<{
  userId: string;
  organizationId: string;
  sessionId: string;
  expiresAt: number;
}>;
export type Event = Readonly<{
  version: 1;
  eventId: string;
  organizationId: string;
  conversationId: string;
  kind: Kind;
  sequence: number;
  occurredAt: number;
  expiresAt: number;
}>;
export type Group = Readonly<{
  key: string;
  organizationId: string;
  conversationId: string;
  sequence: number;
  eventId: string;
  title: "Dashfort";
  body: "Tienes un aviso nuevo en Dashfort";
}>;
export type Destination = Readonly<{
  eventId: string;
  organizationId: string;
  conversationId: string;
  expiresAt: number;
}>;
export type Incoming = Readonly<{ id: string; time: number }>;
export type ConversationSnapshot = Readonly<{
  id: string;
  sequence: number;
  messages: readonly Incoming[];
}>;
export type SyncPage = Readonly<{
  cursor: number;
  events: readonly Event[];
  conversations: readonly ConversationSnapshot[];
}>;
export const users: Readonly<
  Record<string, { role: Role; organizations: readonly string[] }>
> = {
  "demo-owner": { role: "owner", organizations: [ORG_A, ORG_B] },
  "demo-coordinator": { role: "coordinator", organizations: [ORG_A, ORG_B] },
  "demo-advisor": { role: "advisor", organizations: [ORG_A] },
};
export const scopedKey = (org: string, id: string) => `${org}/${id}`;
export function decodeEvent(raw: unknown): Event {
  if (!raw || typeof raw !== "object") throw Error("Aviso ficticio no válido.");
  const e = raw as Event;
  const id = (s: unknown) =>
    typeof s === "string" && /^demo-[a-zA-Z0-9-]{1,110}$/.test(s);
  if (
    e.version !== 1 ||
    !id(e.eventId) ||
    ![ORG_A, ORG_B].includes(e.organizationId) ||
    !id(e.conversationId) ||
    !kinds.includes(e.kind) ||
    !Number.isSafeInteger(e.sequence) ||
    e.sequence < 1 ||
    !Number.isSafeInteger(e.occurredAt) ||
    !Number.isSafeInteger(e.expiresAt) ||
    e.expiresAt <= e.occurredAt
  )
    throw Error("Aviso ficticio no válido.");
  // Copy only the contract: never retain titles, bodies, URLs or arbitrary payload fields.
  return Object.freeze({
    version: 1 as const,
    eventId: e.eventId,
    organizationId: e.organizationId,
    conversationId: e.conversationId,
    kind: e.kind,
    sequence: e.sequence,
    occurredAt: e.occurredAt,
    expiresAt: e.expiresAt,
  });
}
export const eligible = (e: Event) =>
  e.kind === "message.incoming" || e.kind === "handoff";
