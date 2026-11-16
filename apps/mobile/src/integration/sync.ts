import {
  IntegrationError,
  type Scope,
  type SyncPort,
  type Entity,
  type ChangePage,
} from "./contracts";
/** Proposed durable sync protocol exercised only in memory. It is not an HTTP adapter. */
export class IntegrationSync {
  private scope: Scope | null = null;
  private epoch = 0;
  private cursor = 0;
  private rows = new Map<string, Entity>();
  private flights = new Map<number, Promise<void>>();
  private versions = new Map<string, number>();
  private lastSuccess: number | null = null;
  private state: "empty" | "syncing" | "current" | "stale" | "blocked" =
    "empty";
  constructor(
    readonly port: SyncPort,
    readonly now: () => number = Date.now,
  ) {}
  bind(scope: Scope | null) {
    this.epoch++;
    this.scope = scope ? Object.freeze({ ...scope }) : null;
    this.rows.clear();
    this.versions.clear();
    this.cursor = 0;
    this.lastSuccess = null;
    this.state = "empty";
  }
  snapshot() {
    return {
      rows: [...this.rows.values()],
      cursor: this.cursor,
      state: this.state,
      lastSuccess: this.lastSuccess,
      stale:
        this.lastSuccess === null ||
        this.state !== "current" ||
        this.now() - this.lastSuccess > 30000,
    };
  }
  private checkPage(page: ChangePage, s: Scope) {
    if (
      page.organizationId !== s.organizationId ||
      !Number.isSafeInteger(page.cursor) ||
      page.cursor < this.cursor ||
      !Number.isFinite(page.serverTime) ||
      !Array.isArray(page.rows) ||
      page.rows.length > 2000 ||
      new Set([...this.versions.keys(), ...page.rows.map((r) => r.id)]).size >
        2000 ||
      page.rows.some(
        (r) =>
          r.organizationId !== s.organizationId ||
          !Number.isSafeInteger(r.version) ||
          r.version < 1 ||
          r.version > page.cursor ||
          !/^fixture-[\w-]+$/.test(r.id) ||
          typeof r.text !== "string" ||
          typeof r.deleted !== "boolean",
      )
    )
      throw new IntegrationError("invalid");
  }
  sync(): Promise<void> {
    const epoch = this.epoch,
      prior = this.flights.get(epoch);
    if (prior) return prior;
    const scope = this.scope;
    if (!scope || scope.expiresAt <= this.now()) {
      this.bind(null);
      return Promise.reject(new IntegrationError("unauthorized"));
    }
    const run = (async () => {
      this.state = "syncing";
      try {
        const page = await this.port.changes(scope, this.cursor);
        if (epoch !== this.epoch) return;
        if (scope.expiresAt <= this.now())
          throw new IntegrationError("unauthorized");
        this.checkPage(page, scope);
        for (const r of page.rows) {
          if (r.version <= (this.versions.get(r.id) ?? 0)) continue;
          this.versions.set(r.id, r.version);
          if (r.deleted) this.rows.delete(r.id);
          else this.rows.set(r.id, Object.freeze({ ...r }));
        }
        this.cursor = page.cursor;
        this.lastSuccess = this.now();
        this.state = "current";
      } catch (e) {
        if (epoch !== this.epoch) return;
        if (
          e instanceof IntegrationError &&
          ["unauthorized", "forbidden", "not_found"].includes(e.code)
        ) {
          this.bind(null);
          this.state = "blocked";
        } else this.state = "stale";
        throw e;
      } finally {
        this.flights.delete(epoch);
      }
    })();
    this.flights.set(epoch, run);
    return run;
  }
}
