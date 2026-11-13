import type { Identity, Event, SyncPage, ConversationSnapshot } from "./model";
export interface StoragePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}
export interface NotificationBackend {
  authorize(identity: Identity, conversationId?: string): void;
  visible(identity: Identity, event: Event): boolean;
  known(identity: Identity, eventId: string): Event;
  register(identity: Identity, installation: string, token: string): void;
  revoke(installation: string): void;
  sync(identity: Identity, cursor: number): Promise<SyncPage>;
}
export interface ProjectionPort {
  ready?(): boolean;
  apply(
    identity: Identity,
    rows: readonly ConversationSnapshot[],
    current: () => boolean,
  ): Promise<void>;
  canOpen(identity: Identity, conversationId: string): boolean;
  open(conversationId: string): void;
  activeChat(): string | null;
}
