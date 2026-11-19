import {
  AuthFault,
  decodeSession,
  type AuthAuthority,
  type FixtureSession,
  type SessionBoundary,
  type State,
  type CleanupFailure,
  type RevocationState,
  type RevocationRecord,
  type RevocationReference,
  revocationReference,
} from "./model";
import { SessionVault } from "./vault";
/** Disconnected fixture coordinator. No HTTP or UI provider is installed. */
export class PreparedAuth {
  private state: State = Object.freeze({
    status: "anonymous",
    context: null,
    error: null,
    remoteRevocation: "none",
    cleanupFailures: [],
    observerFailures: 0,
  });
  private session: FixtureSession | null = null;
  private candidates = new Map<string, FixtureSession>();
  private pending = new Set<string>();
  private epoch = 0;
  private aborters = new Set<AbortController>();
  private listeners = new Set<() => void>();
  private renewal: { epoch: number; task: Promise<void> } | null = null;
  private recovery: Promise<void> | null = null;
  private boundaryClean = true;
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
    this.state = Object.freeze({
      ...this.state,
      ...p,
      cleanupFailures: Object.freeze([
        ...(p.cleanupFailures ?? this.state.cleanupFailures),
      ]),
    });
    let failures = 0;
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch {
        failures++;
      }
    }
    if (failures)
      this.state = Object.freeze({
        ...this.state,
        observerFailures: Math.min(
          1000,
          this.state.observerFailures + failures,
        ),
      });
  }
  private remember(s: FixtureSession) {
    if (this.candidates.size >= 32 && !this.candidates.has(s.credential))
      return false;
    this.candidates.set(s.credential, s);
    return true;
  }
  private detachBoundary() {
    try {
      this.boundary.detach();
      this.boundaryClean = true;
      return true;
    } catch {
      this.boundaryClean = false;
      return false;
    }
  }
  private boundaryFailures(): readonly CleanupFailure[] {
    let reported: readonly CleanupFailure[] = [];
    try {
      reported = this.boundary.cleanupFailures?.() ?? [];
    } catch {
      /* do not skip credential cleanup */
    }
    const allowed = ["cache", "drafts", "media", "notifications"];
    return [
      "boundary",
      ...reported.filter((code) => allowed.includes(code)).slice(0, 4),
    ];
  }
  private begin(status: State["status"]) {
    // Capture before ANY observer, AbortSignal listener or boundary callback can reenter.
    const epoch = ++this.epoch;
    if (this.session) this.remember(this.session);
    this.session = null;
    this.renewal = null;
    const aborters = [...this.aborters];
    this.aborters.clear();
    for (const a of aborters) {
      try {
        a.abort();
      } catch {
        /* never skip the remaining cleanup */
      }
    }
    if (epoch !== this.epoch) return epoch;
    const clean = this.detachBoundary();
    if (epoch !== this.epoch) return epoch;
    this.patch({
      status: clean ? status : "blocked",
      context: null,
      error: clean ? null : "cleanup",
      cleanupFailures: clean ? [] : this.boundaryFailures(),
    });
    return epoch;
  }
  private addFailures(epoch: number, failures: readonly CleanupFailure[]) {
    if (epoch !== this.epoch || !failures.length) return;
    this.patch({
      cleanupFailures: [
        ...new Set([...this.state.cleanupFailures, ...failures]),
      ],
      status: "blocked",
      context: null,
      error: "cleanup",
    });
  }
  private async revocations(epoch: number, confirmed = false) {
    try {
      const rows = await this.vault.listRevocations();
      if (epoch !== this.epoch) return;
      const outcomes = rows.map((r) => r.outcome);
      const state: RevocationState = outcomes.includes("unknown")
        ? "unknown"
        : outcomes.includes("failed")
          ? "failed"
          : outcomes.length
            ? "pending"
            : confirmed
              ? "confirmed"
              : "none";
      this.patch({ remoteRevocation: state });
    } catch {
      if (epoch === this.epoch) {
        this.patch({ remoteRevocation: "unknown" });
        this.addFailures(epoch, ["revocation-read"]);
      }
      throw new AuthFault("cleanup");
    }
  }
  private async revoke(s: FixtureSession | RevocationReference, epoch: number) {
    const material = "credential" in s ? s : null;
    const reference = revocationReference(
      material ? material.context.scope : s,
    );
    if (material) this.pending.add(material.credential);
    let journalOK = true;
    try {
      await this.vault.recordRevocation(reference, "pending");
    } catch {
      journalOK = false;
      this.addFailures(epoch, ["revocation-write"]);
    }
    if (epoch === this.epoch) this.patch({ remoteRevocation: "pending" });
    let outcome: RevocationRecord["outcome"] | null = null;
    try {
      if (material) await this.authority.revoke(material);
      else if (this.authority.revokeReference)
        await this.authority.revokeReference(reference);
      else throw new AuthFault("unsupported");
    } catch (e) {
      outcome =
        e instanceof AuthFault && e.code === "offline"
          ? "pending"
          : e instanceof AuthFault &&
              ["forbidden", "unauthorized"].includes(e.code)
            ? "failed"
            : "unknown";
    }
    if (outcome) {
      try {
        await this.vault.recordRevocation(reference, outcome);
      } catch {
        journalOK = false;
        this.addFailures(epoch, ["revocation-write"]);
      }
    } else {
      if (material) {
        this.candidates.delete(material.credential);
        this.pending.delete(material.credential);
      }
      try {
        await this.vault.confirmRevocation(reference);
      } catch {
        journalOK = false;
        this.addFailures(epoch, ["revocation-write"]);
      }
    }
    if (journalOK) await this.revocations(epoch, !outcome);
    else if (epoch === this.epoch) this.patch({ remoteRevocation: "unknown" });
  }
  private async orphan(raw: FixtureSession) {
    try {
      const s = decodeSession(raw, 0);
      if (this.session?.credential === s.credential) return;
      this.remember(s);
      await this.revoke(s, this.epoch);
    } catch {
      this.patch({ remoteRevocation: "unknown" });
    }
  }
  private async operation(
    kind: "login" | "restore" | "renew" | "switch",
    work: (
      signal: AbortSignal,
      epoch: number,
    ) => Promise<FixtureSession | null>,
    expected?: FixtureSession,
    org?: string,
  ) {
    // Preserve bounded recovery state; never let capacity prevent logout cleanup.
    if (this.candidates.size >= 32) throw new AuthFault("blocked");
    const epoch = this.begin(kind === "login" ? "authenticating" : "restoring");
    if (epoch !== this.epoch) throw new AuthFault("stale");
    const controller = new AbortController();
    this.aborters.add(controller);
    let result: FixtureSession | null = null;
    try {
      if (!this.boundaryClean) {
        this.addFailures(
          epoch,
          await this.vault.quarantine(() => epoch === this.epoch),
        );
        throw new AuthFault("cleanup");
      }
      result = await work(controller.signal, epoch);
      if (epoch !== this.epoch) throw new AuthFault("stale");
      if (!result) {
        this.patch({ status: "anonymous" });
        return;
      }
      const s = decodeSession(result, this.now());
      if (
        expected &&
        (s.context.scope.userId !== expected.context.scope.userId ||
          s.context.scope.organizationId !==
            (org ?? expected.context.scope.organizationId))
      )
        throw new AuthFault("invalid");
      await this.vault.save(s, () => epoch === this.epoch);
      if (epoch !== this.epoch) throw new AuthFault("stale");
      this.boundary.attach(s.context, () => epoch === this.epoch);
      if (epoch !== this.epoch) throw new AuthFault("stale");
      this.session = s;
      this.candidates.delete(s.credential);
      this.patch({ status: "authenticated", context: s.context, error: null });
      if (epoch !== this.epoch) throw new AuthFault("stale");
    } catch (e) {
      if (epoch !== this.epoch) {
        if (result && kind !== "restore") await this.orphan(result);
        throw new AuthFault("stale");
      }
      const code = e instanceof AuthFault ? e.code : "server";
      this.session = null;
      const clean = this.detachBoundary();
      if (epoch !== this.epoch) throw new AuthFault("stale");
      this.patch({
        status:
          clean && ["offline", "server"].includes(code) ? "stale" : "blocked",
        context: null,
        error: clean ? code : "cleanup",
      });
      if (!clean) this.addFailures(epoch, this.boundaryFailures());
      if (!["offline", "server"].includes(code) || !clean)
        this.addFailures(
          epoch,
          await this.vault.quarantine(() => epoch === this.epoch),
        );
      // A server may have issued a session even when attaching/persisting it failed.
      if (result && kind !== "restore") await this.orphan(result);
      throw new AuthFault(code);
    } finally {
      this.aborters.delete(controller);
    }
  }
  login(email: string, password: string) {
    return this.operation("login", async (signal, epoch) => {
      await this.vault.prepareLogin(() => epoch === this.epoch);
      if (signal.aborted || epoch !== this.epoch) throw new AuthFault("stale");
      return this.authority.login(email, password, signal);
    });
  }
  restore() {
    return this.operation("restore", async (signal, epoch) => {
      await this.revocations(epoch);
      const saved = await this.vault.read();
      if (signal.aborted || epoch !== this.epoch) throw new AuthFault("stale");
      if (!saved) return null;
      this.remember(saved);
      const s = await this.authority.validate(saved, signal);
      if (
        s.context.scope.userId !== saved.context.scope.userId ||
        s.context.scope.organizationId !== saved.context.scope.organizationId
      )
        throw new AuthFault("invalid");
      return s;
    });
  }
  renew() {
    if (this.renewal?.epoch === this.epoch) return this.renewal.task;
    const old = this.session;
    if (!old || !old.context.canRenew)
      return Promise.reject(new AuthFault("unsupported"));
    const expectedEpoch = this.epoch + 1;
    const task = this.operation(
      "renew",
      (s) => this.authority.renew(old, s),
      old,
    );
    if (this.epoch === expectedEpoch)
      this.renewal = { epoch: expectedEpoch, task };
    void task
      .finally(() => {
        if (this.renewal?.task === task) this.renewal = null;
      })
      .catch(() => {});
    return task;
  }
  switchOrganization(org: string) {
    const old = this.session;
    if (!old || !old.context.canSwitchOrganization)
      return Promise.reject(new AuthFault("unsupported"));
    return this.operation(
      "switch",
      (s) => this.authority.switchOrganization(old, org, s),
      old,
      org,
    );
  }
  async logout() {
    const captured = [...this.candidates.values()];
    if (
      this.session &&
      !captured.some((s) => s.credential === this.session!.credential)
    )
      captured.push(this.session);
    this.vault.fence();
    const epoch = this.begin("anonymous");
    const failures: CleanupFailure[] = [];
    if (!this.boundaryClean) failures.push(...this.boundaryFailures());
    // Independent steps: discover known bindings, persist retry intent, erase active credential, try server.
    try {
      const saved = await this.vault.peekForRevocation();
      if (
        saved &&
        epoch === this.epoch &&
        !captured.some((s) => s.credential === saved.credential)
      )
        captured.push(saved);
    } catch {
      failures.push("revocation-read");
      if (epoch === this.epoch) this.patch({ remoteRevocation: "unknown" });
    }
    let persisted: readonly RevocationRecord[] = [];
    try {
      persisted = await this.vault.listRevocations();
    } catch {
      failures.push("revocation-read");
    }
    const candidates = captured.filter(
      (s) => epoch === this.epoch || this.session?.credential !== s.credential,
    );
    for (const s of candidates) this.remember(s);
    for (const s of candidates) {
      try {
        await this.vault.recordRevocation(
          revocationReference(s.context.scope),
          "pending",
        );
      } catch {
        failures.push("revocation-write");
      }
    }
    failures.push(...(await this.vault.quarantine(() => epoch === this.epoch)));
    this.addFailures(epoch, failures);
    for (const s of candidates) await this.revoke(s, epoch);
    for (const r of persisted)
      if (
        !candidates.some(
          (s) => s.context.scope.sessionId === r.reference.sessionId,
        )
      )
        await this.revoke(r.reference, epoch);
    if (!candidates.length && !failures.length) await this.revocations(epoch);
    if (failures.includes("revocation-read") && epoch === this.epoch)
      this.patch({ remoteRevocation: "unknown" });
    if (epoch !== this.epoch) throw new AuthFault("stale");
    if (this.state.cleanupFailures.length) throw new AuthFault("cleanup");
  }
  recoverRevocations() {
    if (this.recovery) return this.recovery;
    const epoch = this.epoch;
    const task = (async () => {
      try {
        const persisted = await this.vault.listRevocations();
        const candidates = [...this.candidates.values()].filter((s) =>
          this.pending.has(s.credential),
        );
        for (const s of candidates) await this.revoke(s, epoch);
        for (const r of persisted)
          if (
            !candidates.some(
              (s) => s.context.scope.sessionId === r.reference.sessionId,
            )
          )
            await this.revoke(r.reference, epoch);
        await this.revocations(
          epoch,
          this.state.remoteRevocation === "confirmed",
        );
      } catch {
        if (epoch === this.epoch) {
          this.patch({ remoteRevocation: "unknown" });
          this.addFailures(epoch, ["revocation-read"]);
        }
      }
    })();
    this.recovery = task;
    void task
      .finally(() => {
        if (this.recovery === task) this.recovery = null;
      })
      .catch(() => {});
    return task;
  }
  async invalidateAccess(code: "unauthorized" | "forbidden") {
    const epoch = this.begin("blocked");
    if (epoch !== this.epoch) return;
    this.patch({ error: code });
    this.addFailures(
      epoch,
      await this.vault.quarantine(() => epoch === this.epoch),
    );
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
      if (s.context.scope.expiresAt <= this.now())
        throw new AuthFault("unauthorized");
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
