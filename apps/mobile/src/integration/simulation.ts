import {
  IntegrationError,
  environment,
  type Scope,
  type AuthPort,
  type SyncPort,
  type SendPort,
  type ChangePage,
  type SendCommand,
  type Entity,
  type IntegrationMode,
} from "./contracts";
/** No sockets, HTTP, DB, SDK, filesystem or credentials. No relation to active demo providers. */
export class IsolatedCrm implements AuthPort, SyncPort, SendPort {
  readonly configuration;
  private serial = 0;
  private sessions = new Map<string, Scope>();
  private log: Entity[] = [];
  private sent = new Map<string, { command: string; messageId: string }>();
  private denied = new Set<string>();
  online = true;
  failNext = false;
  uncertainNext = false;
  beforeChanges: (() => Promise<void>) | null = null;
  constructor(
    mode: IntegrationMode = "isolated-test",
    readonly now: () => number = Date.now,
  ) {
    this.configuration = environment(mode);
  }
  async login(email: string, password: string) {
    if (!this.online) throw new IntegrationError("offline");
    if (email !== "operator@example.invalid" || password !== "fixture-password")
      throw new IntegrationError("unauthorized");
    if (this.sessions.size >= 64) throw new IntegrationError("blocked");
    const s = Object.freeze({
      userId: "fixture-user",
      organizationId: "fixture-org-a",
      sessionId: `fixture-session-${++this.serial}`,
      expiresAt: this.now() + 3600000,
    });
    this.sessions.set(s.sessionId, s);
    return s;
  }
  private authorize(s: Scope) {
    const current = this.sessions.get(s.sessionId);
    if (
      !current ||
      JSON.stringify(current) !== JSON.stringify(s) ||
      s.expiresAt <= this.now()
    )
      throw new IntegrationError("unauthorized");
    if (!this.online) throw new IntegrationError("offline");
  }
  async validate(s: Scope) {
    this.authorize(s);
    return s;
  }
  async refresh(s: Scope) {
    this.authorize(s);
    this.sessions.delete(s.sessionId);
    const next = Object.freeze({
      ...s,
      sessionId: `fixture-session-${++this.serial}`,
      expiresAt: this.now() + 3600000,
    });
    this.sessions.set(next.sessionId, next);
    return next;
  }
  async logout(s: Scope) {
    this.sessions.delete(s.sessionId);
  }
  revoke(s: Scope) {
    this.sessions.delete(s.sessionId);
  }
  async switchOrganization(s: Scope, organizationId: string) {
    this.authorize(s);
    if (!["fixture-org-a", "fixture-org-b"].includes(organizationId))
      throw new IntegrationError("forbidden");
    await this.logout(s);
    const next = Object.freeze({
      ...s,
      organizationId,
      sessionId: `fixture-session-${++this.serial}`,
    });
    this.sessions.set(next.sessionId, next);
    return next;
  }
  publish(
    id: string,
    text = "Mensaje sintético",
    organizationId = "fixture-org-a",
    deleted = false,
  ) {
    if (
      !/^fixture-[\w-]+$/.test(id) ||
      !["fixture-org-a", "fixture-org-b"].includes(organizationId)
    )
      throw new IntegrationError("invalid");
    if (this.log.length >= 2000) throw new IntegrationError("blocked");
    const row = Object.freeze({
      organizationId,
      id,
      text,
      deleted,
      version: this.log.length + 1,
    });
    this.log.push(row);
    return row;
  }
  loseConversation(id: string, organizationId = "fixture-org-a") {
    this.denied.add(`${organizationId}/${id}`);
    this.publish(id, "", organizationId, true);
  }
  async changes(s: Scope, cursor: number): Promise<ChangePage> {
    this.authorize(s);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.log.length)
      throw new IntegrationError("invalid");
    if (this.beforeChanges) await this.beforeChanges();
    this.authorize(s);
    if (this.failNext) {
      this.failNext = false;
      throw new IntegrationError("server");
    }
    return {
      organizationId: s.organizationId,
      cursor: this.log.length,
      serverTime: this.now(),
      rows: this.log.filter(
        (e) => e.organizationId === s.organizationId && e.version > cursor,
      ),
    };
  }
  async send(s: Scope, command: SendCommand) {
    this.authorize(s);
    if (
      !/^fixture-[\w-]+$/.test(command.conversationId) ||
      !/^fixture-[\w-]+$/.test(command.idempotencyKey) ||
      !command.text.trim() ||
      command.text.length > 65536
    )
      throw new IntegrationError("invalid");
    if (
      this.denied.has(`${s.organizationId}/${command.conversationId}`) ||
      !this.log.some(
        (e) =>
          e.organizationId === s.organizationId &&
          e.id === command.conversationId,
      )
    )
      throw new IntegrationError("not_found");
    const k = `${s.organizationId}/${s.userId}/${command.idempotencyKey}`,
      value = JSON.stringify(command),
      prior = this.sent.get(k);
    if (prior) {
      if (prior.command !== value) throw new IntegrationError("conflict");
      return { messageId: prior.messageId };
    }
    if (this.sent.size >= 2000) throw new IntegrationError("blocked");
    const messageId = `fixture-message-${++this.serial}`;
    this.sent.set(k, { command: value, messageId });
    if (this.uncertainNext) {
      this.uncertainNext = false;
      throw new IntegrationError("uncertain");
    }
    return { messageId };
  }
}
