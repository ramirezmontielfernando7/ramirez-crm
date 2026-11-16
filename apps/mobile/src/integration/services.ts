/** Mobile service boundaries. No provider is connected to screens or real HTTP. */
import type { Scope } from "./contracts";
import type { WireConversation, WireMessage } from "./wire";
export type InboxQuery = Readonly<{
  q?: string;
  assigned?: string;
  stage?: string;
  tag?: string;
  status?: "all" | "unread" | "archived" | "humano" | "anuncios";
  cursor?: string;
  limit?: number;
}>;
export type ContactProjection = Readonly<{
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
}>;
export interface CrmReadPort {
  conversations(
    scope: Scope,
    query: InboxQuery,
  ): Promise<{
    conversations: readonly WireConversation[];
    nextCursor: string | null;
  }>;
  /** Current server returns the whole history or createdAt > since, without history cursor. */
  messages(
    scope: Scope,
    conversationId: string,
    since?: string,
  ): Promise<readonly WireMessage[]>;
  contact(scope: Scope, contactId: string): Promise<ContactProjection>;
  assignments(
    scope: Scope,
    contactId: string,
  ): Promise<readonly { userId: string | null }[]>;
}
export interface CrmActionPort {
  /** Capability is false for current CRM. Do not replay a request on timeout. */
  readonly supportsIdempotency: false;
  send(
    scope: Scope,
    conversationId: string,
    text: string,
  ): Promise<{ messageId: string; queuedUntil?: string }>;
  patchConversation(
    scope: Scope,
    id: string,
    patch: {
      aiEnabled?: boolean;
      reactivate?: boolean;
      markRead?: boolean;
      archived?: boolean;
    },
  ): Promise<void>;
  patchContact(
    scope: Scope,
    id: string,
    patch: { name?: string; notes?: string | null },
  ): Promise<void>;
  assign(
    scope: Scope,
    contactIds: readonly string[],
    userId: string | null,
  ): Promise<void>;
}
