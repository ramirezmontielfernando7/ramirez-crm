import {
  AuthFault,
  decodeSession,
  type AuthAuthority,
  type FixtureSession,
  type SessionBoundary,
  type State,
} from "./model";
import { SessionVault } from "./vault";
/** Pure coordinator, never mounted in SessionProvider. All observers receive context, never credentials. */
export class PreparedAuth {
  private state: State = {
    status: "anonymous",
    context: null,
    error: null,
    remoteRevocation: "none",
  };
  private session: FixtureSession | null = null;
  private pendingRevocation: FixtureSession | null = null;
  private epoch = 0;
  private aborters = new Set<AbortController>();
  private listeners = new Set<() => void>();
  private renewal: Promise<void> | null = null;
  constructor(
    private authority: AuthAuthority,
    private vault: SessionVault,
    private boundary: SessionBoundary,
    private now = Date.now,
  ) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private patch(p: Partial<State>) {
    this.state = Object.freeze({ ...this.state, ...p });
    this.listeners.forEach((fn) => fn());
  }
  private detach(status: State["status"]) {
    this.epoch++;
    for (const a of this.aborters) a.abort();
    this.aborters.clear();
    this.renewal = null;
    this.session = null;
    this.patch({
      status,
      context: null,
      error: null,
      remoteRevocation: "none",
    });
    this.boundary.detach();
    return this.epoch;
  }
  private async install(
    epoch: number,
    session: FixtureSession,
    expected?: FixtureSession,
    organizationId?: string,
  ) {
    if (epoch !== this.epoch) throw new AuthFault("stale");
    const s = decodeSession(session, this.now());
    if (
      expected &&
      (s.context.scope.userId !== expected.context.scope.userId ||
        s.context.scope.organizationId !==
          (organizationId ?? expected.context.scope.organizationId))
    )
      throw new AuthFault("invalid");
    await this.vault.save(s, () => epoch === this.epoch);
    if (epoch !== this.epoch) throw new AuthFault("stale");
    this.boundary.attach(s.context);
    this.session = s;
    this.pendingRevocation = null;
    this.patch({ status: "authenticated", context: s.context, error: null });
  }
  private async operation(
    status: State["status"],
    work: (signal: AbortSignal) => Promise<FixtureSession | null>,
    expected?: FixtureSession,
    org?: string,
  ) {
    this.pendingRevocation = this.session ?? this.pendingRevocation;
    const epoch = this.detach(status),
      controller = new AbortController();
    this.aborters.add(controller);
    try {
      const result = await work(controller.signal);
      if (epoch !== this.epoch) throw new AuthFault("stale");
      if (result) await this.install(epoch, result, expected, org);
      else this.patch({ status: "anonymous" });
    } catch (e) {
      if (epoch !== this.epoch) throw new AuthFault("stale");
      const code = e instanceof AuthFault ? e.code : "server";
      this.session = null;
      this.boundary.detach();
      this.patch({
        status: code === "offline" || code === "server" ? "stale" : "blocked",
        context: null,
        error: code,
      });
      // Keep a secure fixture credential ONLY for a later validated restore after transient errors.
      if (!["offline", "server"].includes(code)) {
        try {
          await this.vault.clear();
        } catch {
          if (epoch === this.epoch) this.patch({ error: "storage" });
        }
      }
      throw new AuthFault(code);
    } finally {
      this.aborters.delete(controller);
    }
  }
  login(email: string, password: string) {
    return this.operation("authenticating", async (signal) => {
      await this.vault.clear();
      if (signal.aborted) throw new AuthFault("stale");
      return this.authority.login(email, password, signal);
    });
  }
  restore() {
    return this.operation("restoring", async (signal) => {
      const saved = await this.vault.read();
      if (signal.aborted) throw new AuthFault("stale");
      if (!saved) return null;
      const validated = await this.authority.validate(saved, signal);
      if (
        validated.context.scope.userId !== saved.context.scope.userId ||
        validated.context.scope.organizationId !==
          saved.context.scope.organizationId
      )
        throw new AuthFault("invalid");
      return validated;
    });
  }
  renew() {
    if (this.renewal) return this.renewal;
    const old = this.session;
    if (!old || !old.context.canRenew)
      return Promise.reject(new AuthFault("unsupported"));
    const task = this.operation(
      "restoring",
      (signal) => this.authority.renew(old, signal),
      old,
    );
    this.renewal = task;
    void task
      .finally(() => {
        if (this.renewal === task) this.renewal = null;
      })
      .catch(() => {});
    return task;
  }
  switchOrganization(organizationId: string) {
    const old = this.session;
    if (!old || !old.context.canSwitchOrganization)
      return Promise.reject(new AuthFault("unsupported"));
    return this.operation(
      "restoring",
      (signal) =>
        this.authority.switchOrganization(old, organizationId, signal),
      old,
      organizationId,
    );
  }
  async logout() {
    const old = this.session ?? this.pendingRevocation;
    this.pendingRevocation = null;
    const epoch = this.detach("anonymous");
    let cleared = true;
    try {
      await this.vault.clear();
    } catch {
      cleared = false;
      if (epoch === this.epoch)
        this.patch({ status: "blocked", error: "storage" });
    }
    if (old) {
      try {
        await this.authority.revoke(old);
        if (epoch === this.epoch) this.patch({ remoteRevocation: "confirmed" });
      } catch {
        if (epoch === this.epoch)
          this.patch({ remoteRevocation: "unconfirmed" });
      }
    }
    if (!cleared) throw new AuthFault("storage");
  }
  async invalidateAccess(code: "unauthorized" | "forbidden") {
    const epoch = this.detach("blocked");
    this.patch({ error: code });
    try {
      await this.vault.clear();
    } catch {
      if (epoch === this.epoch) this.patch({ error: "storage" });
      throw new AuthFault("storage");
    }
  }
  async guarded<T>(
    work: (
      context: NonNullable<State["context"]>,
      signal: AbortSignal,
    ) => Promise<T>,
  ): Promise<T> {
    const s = this.session,
      epoch = this.epoch;
    if (!s || this.state.status !== "authenticated")
      throw new AuthFault("unauthorized");
    if (s.context.scope.expiresAt <= this.now()) {
      await this.invalidateAccess("unauthorized");
      throw new AuthFault("unauthorized");
    }
    const controller = new AbortController();
    this.aborters.add(controller);
    try {
      const value = await work(s.context, controller.signal);
      if (epoch !== this.epoch || controller.signal.aborted)
        throw new AuthFault("stale");
      if (s.context.scope.expiresAt <= this.now()) {
        throw new AuthFault("unauthorized");
      }
      return value;
    } catch (e) {
      if (epoch !== this.epoch) throw new AuthFault("stale");
      if (
        e instanceof AuthFault &&
        (e.code === "unauthorized" || e.code === "forbidden")
      )
        await this.invalidateAccess(e.code);
      throw e instanceof AuthFault ? e : new AuthFault("server");
    } finally {
      this.aborters.delete(controller);
    }
  }
}
