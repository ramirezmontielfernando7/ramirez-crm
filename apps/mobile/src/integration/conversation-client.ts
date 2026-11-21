import { IntegrationError, type Scope } from "./contracts";
import type { CrmReadPort, CrmActionPort, InboxQuery } from "./services";
import {
  conversationRequest,
  conversationsResponse,
  messagesResponse,
  type WireConversation,
  type WireMessage,
} from "./wire";
/** SSE has no durable replay. Every reconnect requires canonical read reconciliation. */
export class PreparedConversations {
  private epoch = 0;
  private queryRevision = 0;
  private scope: Scope | null = null;
  private rows = new Map<string, WireConversation>();
  private history = new Map<string, readonly WireMessage[]>();
  private flights = new Map<string, Promise<void>>();
  private cursor: string | null = null;
  private sends = new Map<
    string,
    {
      text: string;
      conversationId: string;
      state: "sending" | "confirmed" | "unknown" | "rejected";
      messageId?: string;
    }
  >();
  private stale = true;
  private query: InboxQuery = {};
  constructor(
    private read: CrmReadPort,
    private actions: CrmActionPort,
    private now = Date.now,
  ) {}
  bind(scope: Scope | null) {
    this.epoch++;
    this.queryRevision++;
    this.scope = scope ? Object.freeze({ ...scope }) : null;
    this.rows.clear();
    this.history.clear();
    this.sends.clear();
    this.flights.clear();
    this.cursor = null;
    this.stale = true;
    this.query = {};
  }
  private lease() {
    if (!this.scope || this.scope.expiresAt <= this.now()) {
      this.bind(null);
      throw new IntegrationError("unauthorized");
    }
    return { scope: this.scope, epoch: this.epoch };
  }
  private check(epoch: number) {
    if (epoch !== this.epoch) throw new IntegrationError("blocked");
    if (!this.scope || this.scope.expiresAt <= this.now()) {
      this.bind(null);
      throw new IntegrationError("unauthorized");
    }
  }
  private fail(e: unknown, epoch: number): never {
    if (epoch === this.epoch) {
      this.stale = true;
      if (
        e instanceof IntegrationError &&
        ["unauthorized", "forbidden", "not_found"].includes(e.code)
      )
        this.bind(null);
    }
    throw e instanceof IntegrationError ? e : new IntegrationError("server");
  }
  snapshot() {
    return {
      conversations: [...this.rows.values()],
      nextCursor: this.cursor,
      stale: this.stale,
      pending: [...this.sends.entries()].map(([id, s]) => ({
        id,
        state: s.state,
        messageId: s.messageId,
      })),
    };
  }
  messages(id: string) {
    return this.history.get(id) ?? [];
  }
  async inbox(query: InboxQuery = {}, append = false) {
    const { scope, epoch } = this.lease();
    const key = JSON.stringify({
      query,
      append,
      cursor: append ? this.cursor : null,
    });
    const prior = this.flights.get(key);
    if (prior) return prior;
    if (this.flights.size >= 20) throw new IntegrationError("blocked");
    const queryRevision = ++this.queryRevision;
    const task = (async () => {
      try {
        const p = await this.read.conversations(scope, {
          ...query,
          cursor: append ? (this.cursor ?? undefined) : undefined,
        });
        this.check(epoch);
        if (queryRevision !== this.queryRevision)
          throw new IntegrationError("blocked");
        if (p.conversations.length > 500) throw new IntegrationError("invalid");
        const next = append
          ? new Map(this.rows)
          : new Map<string, WireConversation>();
        for (const c of p.conversations) next.set(c.id, c);
        if (next.size > 10000) throw new IntegrationError("invalid");
        this.rows = next;
        this.query = { ...query };
        this.cursor = p.nextCursor;
        this.stale = false;
      } catch (e) {
        if (queryRevision !== this.queryRevision) throw e;
        this.fail(e, epoch);
      }
    })();
    this.flights.set(key, task);
    try {
      await task;
    } finally {
      if (this.flights.get(key) === task) this.flights.delete(key);
    }
  }
  async refreshHistory(id: string) {
    const { scope, epoch } = this.lease();
    try {
      const rows = await this.read.messages(scope, id);
      this.check(epoch);
      if (rows.length > 10000 || rows.some((m) => m.conversationId !== id))
        throw new IntegrationError("invalid");
      const unique = new Map(rows.map((m) => [m.id, Object.freeze({ ...m })]));
      const ordered = [...unique.values()].sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
      if (this.history.size >= 20 && !this.history.has(id))
        this.history.delete(this.history.keys().next().value!);
      this.history.set(id, Object.freeze(ordered));
    } catch (e) {
      this.fail(e, epoch);
    }
  }
  eventHint() {
    this.stale = true;
  }
  reconnect() {
    return this.inbox(this.query);
  }
  async send(attemptId: string, conversationId: string, text: string) {
    const { scope, epoch } = this.lease();
    if (
      !/^fixture-[\w-]{1,100}$/.test(attemptId) ||
      !text.trim() ||
      text.length > 4096
    )
      throw new IntegrationError("invalid");
    if (this.sends.has(attemptId)) throw new IntegrationError("uncertain");
    if (this.sends.size >= 200) throw new IntegrationError("blocked");
    const pending = {
      text,
      conversationId,
      state: "sending" as "sending" | "confirmed" | "unknown" | "rejected",
    };
    this.sends.set(attemptId, pending);
    try {
      const r = await this.actions.send(scope, conversationId, text);
      this.check(epoch);
      this.sends.set(attemptId, {
        ...pending,
        state: "confirmed",
        messageId: r.messageId,
      });
      this.stale = true;
    } catch (e) {
      if (epoch === this.epoch)
        this.sends.set(attemptId, {
          ...pending,
          state:
            e instanceof IntegrationError &&
            ["unauthorized", "forbidden", "not_found", "invalid"].includes(
              e.code,
            )
              ? "rejected"
              : "unknown",
        });
      this.fail(e, epoch);
    }
  }
  /** An unknown write is reconciled/read, never automatically replayed. */
  reconcile() {
    return this.inbox(this.query);
  }
  async assign(ids: readonly string[], userId: string | null) {
    const { scope, epoch } = this.lease();
    try {
      await this.actions.assign(scope, ids, userId);
      this.check(epoch);
      this.stale = true;
    } catch (e) {
      this.fail(e, epoch);
    }
  }
}

/** Staging uses only the two existing CRM read endpoints. */
export function createReadOnlyConversationClient(
  read: (path: string) => Promise<unknown>,
) {
  return {
    async page(cursor?: string) {
      return conversationsResponse(
        await read(conversationRequest({ cursor, limit: 40 }).path),
      );
    },
    async history(id: string) {
      if (!/^[\w-]{1,200}$/.test(id)) throw new IntegrationError("invalid");
      return messagesResponse(
        await read(`/api/conversations/${encodeURIComponent(id)}/messages`),
        id,
      );
    },
  };
}
