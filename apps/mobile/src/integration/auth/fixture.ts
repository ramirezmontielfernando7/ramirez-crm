import {
  AuthFault,
  decodeSession,
  type AuthAuthority,
  type FixtureSession,
} from "./model";
export const fixtureUsers = Object.freeze([
  {
    email: "owner@example.invalid",
    id: "fixture-owner",
    role: "owner",
    organizations: ["fixture-org-a", "fixture-org-b"],
    permissions: ["scope.all", "assignment.manage", "users.manage"],
  },
  {
    email: "coordinador@example.invalid",
    id: "fixture-coordinador",
    role: "coordinador",
    organizations: ["fixture-org-a"],
    permissions: ["scope.all", "assignment.manage"],
  },
  {
    email: "asesor@example.invalid",
    id: "fixture-asesor",
    role: "asesor",
    organizations: ["fixture-org-a"],
    permissions: [],
  },
] as const);
/** Test double for lifecycle, NOT a Better Auth implementation or cookie protocol. */
export class FixtureAuthority implements AuthAuthority {
  private serial = 0;
  private sessions = new Map<string, FixtureSession>();
  online = true;
  failNext = false;
  renewable = true;
  allowOrganizationSwitch = false;
  before: ((operation: string) => Promise<void>) | null = null;
  constructor(readonly now = Date.now) {}
  private async gate(op: string, signal?: AbortSignal) {
    if (this.before) await this.before(op);
    if (signal?.aborted) throw new AuthFault("stale");
    if (!this.online) throw new AuthFault("offline");
    if (this.failNext) {
      this.failNext = false;
      throw new AuthFault("server");
    }
  }
  private issue(user: (typeof fixtureUsers)[number], organizationId: string) {
    const id = ++this.serial;
    if (this.sessions.size >= 64) throw new AuthFault("blocked");
    const s = decodeSession(
      {
        version: 1,
        environment: "i2p-memory",
        credential: `fixture-cookie-${id}`,
        context: {
          scope: {
            userId: user.id,
            organizationId,
            sessionId: `fixture-session-${id}`,
            expiresAt: this.now() + 3600000,
          },
          role: user.role,
          permissions: user.permissions,
          canRenew: this.renewable,
          canSwitchOrganization: this.allowOrganizationSwitch,
        },
      },
      this.now(),
    );
    this.sessions.set(s.credential, s);
    return s;
  }
  private known(s: FixtureSession) {
    const current = this.sessions.get(s.credential);
    if (
      !current ||
      current.context.scope.expiresAt <= this.now() ||
      current.context.scope.userId !== s.context.scope.userId ||
      current.context.scope.organizationId !== s.context.scope.organizationId ||
      current.context.scope.sessionId !== s.context.scope.sessionId
    )
      throw new AuthFault("unauthorized");
    return current;
  }
  async login(email: string, password: string, signal: AbortSignal) {
    await this.gate("login", signal);
    const user = fixtureUsers.find((u) => u.email === email);
    if (!user || password !== "fixture-password")
      throw new AuthFault("unauthorized");
    return this.issue(user, "fixture-org-a");
  }
  async validate(s: FixtureSession, signal: AbortSignal) {
    await this.gate("validate", signal);
    return this.known(s);
  }
  async renew(s: FixtureSession, signal: AbortSignal) {
    await this.gate("renew", signal);
    const current = this.known(s);
    if (!current.context.canRenew) throw new AuthFault("unsupported");
    const user = fixtureUsers.find(
      (u) => u.id === current.context.scope.userId,
    )!;
    this.sessions.delete(s.credential);
    return this.issue(user, current.context.scope.organizationId);
  }
  async switchOrganization(
    s: FixtureSession,
    org: string,
    signal: AbortSignal,
  ) {
    await this.gate("switch", signal);
    const current = this.known(s);
    if (!current.context.canSwitchOrganization)
      throw new AuthFault("unsupported");
    const user = fixtureUsers.find(
      (u) => u.id === current.context.scope.userId,
    )!;
    if (!(user.organizations as readonly string[]).includes(org))
      throw new AuthFault("forbidden");
    this.sessions.delete(s.credential);
    return this.issue(user, org);
  }
  async revoke(s: FixtureSession) {
    await this.gate("revoke");
    this.sessions.delete(s.credential);
  }
  forceRevoke(s: FixtureSession) {
    this.sessions.delete(s.credential);
  }
}
