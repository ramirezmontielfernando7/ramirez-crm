import {
  decodeEvent,
  eligible,
  scopedKey,
  type Event,
  type Group,
  type Identity,
  type Destination,
  type Permission,
} from "./model";
import type { NotificationBackend, ProjectionPort, StoragePort } from "./ports";
import { MAX_GROUPS, MAX_LEDGER, remember } from "./dedupe";
import { DemoRegistration } from "./registration";
import { checkDestination } from "./routing";
import { SyncFlights } from "./sync";
import { genericNotice, fresh, shouldPresent } from "./policy";
export type State = Readonly<{
  ready: boolean;
  identity: Identity | null;
  permission: Permission;
  online: boolean;
  foreground: boolean;
  groups: readonly Group[];
  seen: readonly string[];
  opened: readonly string[];
  pending: Destination | null;
  cursor: number;
  syncing: boolean;
  error: string;
  result: string;
  revocationPending: boolean;
  registered: boolean;
}>;
export class NotificationStore {
  private state: State = {
    ready: false,
    identity: null,
    permission: "denied",
    online: true,
    foreground: true,
    groups: [],
    seen: [],
    opened: [],
    pending: null,
    cursor: 0,
    syncing: false,
    error: "",
    result: "",
    revocationPending: false,
    registered: false,
  };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private flights = new SyncFlights();
  private writes: Promise<void> = Promise.resolve();
  private dirty = false;
  private writing = false;
  private loading: Promise<void> | null = null;
  private scopeData = new Map<
    string,
    { seen: readonly string[]; opened: readonly string[]; cursor: number }
  >();
  readonly registration: DemoRegistration;
  readonly key: string;
  constructor(
    readonly backend: NotificationBackend,
    readonly storage: StoragePort,
    readonly projection: ProjectionPort,
    readonly now: () => number = Date.now,
    installation = "demo-install-local",
  ) {
    this.key = `dashfort.demo.notifications.v1.${installation}`;
    this.registration = new DemoRegistration(installation, backend);
  }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private patch(p: Partial<State>) {
    if (Object.entries(p).every(([k, v]) => this.state[k as keyof State] === v))
      return;
    this.state = { ...this.state, ...p };
    this.listeners.forEach((fn) => fn());
  }
  private scope(i = this.state.identity) {
    return i ? `${i.userId}/${i.organizationId}` : "";
  }
  private save() {
    if (!this.state.ready)
      return Promise.reject(Error("Recupera los avisos antes de guardar."));
    const s = this.state;
    const scope = this.scope();
    if (scope)
      this.scopeData.set(scope, {
        seen: s.seen,
        opened: s.opened,
        cursor: s.cursor,
      });
    // No authentication credential, device fingerprint, token, message body or customer data persisted.
    this.dirty = true;
    if (!this.writing) {
      this.writing = true;
      this.writes = (async () => {
        try {
          while (this.dirty) {
            this.dirty = false;
            await this.storage.set(
              this.key,
              JSON.stringify({
                version: 1,
                scopes: [...this.scopeData].slice(-12),
                pending: this.state.pending,
                revocationPending: this.registration.pendingRevocation,
              }),
            );
          }
        } finally {
          this.writing = false;
        }
      })();
    }
    return this.writes;
  }
  flush = () => this.writes;
  hydrate = () => {
    if (this.state.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    const epoch = this.epoch;
    this.loading = (async () => {
      try {
        const raw = await this.storage.get(this.key);
        if (epoch !== this.epoch) return;
        if (raw) {
          const d = JSON.parse(raw);
          if (
            d.version !== 1 ||
            !Array.isArray(d.scopes) ||
            d.scopes.length > 12
          )
            throw Error("Datos locales de avisos no válidos.");
          for (const row of d.scopes) {
            if (
              !Array.isArray(row) ||
              row.length !== 2 ||
              typeof row[0] !== "string" ||
              !/^demo-[\w-]+\/demo-org-[ab]$/.test(row[0])
            )
              throw Error("Ámbito local no válido.");
            const x = row[1];
            if (
              !x ||
              !Number.isSafeInteger(x.cursor) ||
              x.cursor < 0 ||
              ![x.seen, x.opened].every(
                (a) =>
                  Array.isArray(a) &&
                  a.length <= MAX_LEDGER &&
                  a.every(
                    (k) =>
                      typeof k === "string" && /^demo-[\w-]{1,110}$/.test(k),
                  ),
              )
            )
              throw Error("Registro local no válido.");
            this.scopeData.set(row[0], {
              seen: x.seen,
              opened: x.opened,
              cursor: x.cursor,
            });
          }
          if (d.pending !== null) {
            const p = d.pending;
            decodeEvent({
              version: 1,
              ...p,
              kind: "message.incoming",
              sequence: 1,
              occurredAt: 0,
            });
            this.patch({
              pending: {
                eventId: p.eventId,
                organizationId: p.organizationId,
                conversationId: p.conversationId,
                expiresAt: p.expiresAt,
              },
            });
          }
        }
        const prior = this.scopeData.get(this.scope());
        this.patch({ ready: true, ...prior, error: "" });
        // A restarted fake installation has no retained permission/session authority.
        this.registration.revoke(this.state.online);
        this.patch({
          registered: false,
          revocationPending: this.registration.pendingRevocation,
        });
      } catch (e) {
        this.scopeData.clear();
        this.patch({
          ready: false,
          error:
            e instanceof Error
              ? e.message
              : "No se pudieron cargar los avisos.",
        });
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  };
  identity = (identity: Identity | null) => {
    const old = this.state.identity;
    if (JSON.stringify(old) === JSON.stringify(identity)) {
      this.reconcile();
      return;
    }
    this.epoch++;
    this.registration.revoke(this.state.online);
    const prior = identity
      ? this.scopeData.get(this.scope(identity))
      : undefined;
    // History is scoped; destinations survive only to be reauthorized after login, never blindly opened.
    this.patch({
      identity: identity ? { ...identity } : null,
      pending:
        old && (!identity || old.userId !== identity.userId)
          ? null
          : this.state.pending,
      groups: [],
      seen: prior?.seen ?? [],
      opened: prior?.opened ?? [],
      cursor: prior?.cursor ?? 0,
      syncing: false,
      result: identity
        ? "Sesión ficticia actualizada"
        : "Sesión cerrada; avisos retirados",
      error: "",
      registered: false,
      revocationPending: this.registration.pendingRevocation,
    });
    this.reconcile();
    void this.save().catch((e) => this.failure(e));
  };
  private failure(e: unknown) {
    this.patch({
      error: e instanceof Error ? e.message : "Error de avisos ficticios.",
    });
  }
  private reconcile() {
    if (!this.state.ready) {
      this.registration.revoke(this.state.online);
      this.patch({
        registered: false,
        revocationPending: this.registration.pendingRevocation,
      });
      return;
    }
    try {
      this.registration.reconcile(
        this.state.identity,
        this.state.permission,
        this.state.online,
      );
      this.patch({
        registered: !!this.registration.token,
        revocationPending: this.registration.pendingRevocation,
      });
    } catch (e) {
      this.registration.revoke(this.state.online);
      this.patch({
        registered: false,
        revocationPending: this.registration.pendingRevocation,
      });
      this.failure(e);
    }
  }
  permission = (permission: Permission) => {
    if (!["granted", "denied", "revoked"].includes(permission))
      throw Error("Permiso ficticio no válido.");
    this.patch({
      permission,
      groups: permission === "granted" ? this.state.groups : [],
    });
    this.reconcile();
    void this.save().catch((e) => this.failure(e));
  };
  rotate = () => {
    try {
      if (
        !this.state.identity ||
        this.state.permission !== "granted" ||
        !this.state.online
      )
        throw Error("Renovación ficticia requiere sesión, permiso y conexión.");
      this.registration.reconcile(
        this.state.identity,
        this.state.permission,
        this.state.online,
        true,
      );
      this.patch({
        registered: !!this.registration.token,
        result: "Token ficticio renovado",
      });
    } catch (e) {
      this.failure(e);
    }
  };
  connection = async (online: boolean) => {
    const changed = online !== this.state.online;
    this.patch({ online });
    this.reconcile();
    if (changed && online) await this.sync();
  };
  foreground = async (foreground: boolean) => {
    const changed = foreground !== this.state.foreground;
    this.patch({ foreground });
    if (changed && foreground) await this.sync();
  };
  receive = async (raw: unknown) => {
    try {
      await this.hydrate();
      if (!this.state.ready)
        throw Error("Recupera los avisos antes de continuar.");
      const e = decodeEvent(raw);
      const i = this.state.identity;
      if (
        !i ||
        !this.state.online ||
        !this.backend.visible(i, e) ||
        !fresh(e, this.now())
      )
        return;
      const canonical = this.backend.known(i, e.eventId);
      if (JSON.stringify(e) !== JSON.stringify(canonical))
        throw Error("El evento no coincide con su fuente ficticia.");
      if (this.state.seen.includes(e.eventId)) {
        if (this.state.error) {
          await this.save();
          this.patch({ error: "" });
          if (this.state.foreground) await this.sync();
        }
        return;
      }
      const epoch = this.epoch;
      this.accept(e);
      await this.save();
      if (epoch !== this.epoch) return;
      this.patch({ error: "" });
      if (this.state.foreground) await this.sync();
    } catch (e) {
      this.failure(e);
    }
  };
  private accept(e: Event) {
    const key = scopedKey(e.organizationId, e.conversationId),
      old = this.state.groups.find((g) => g.key === key);
    let groups = this.state.groups;
    if (
      shouldPresent(
        e,
        this.state.permission,
        this.state.foreground,
        this.projection.activeChat(),
      ) &&
      (!old || e.sequence > old.sequence)
    )
      groups = [
        ...groups.filter((g) => g.key !== key),
        {
          key,
          organizationId: e.organizationId,
          conversationId: e.conversationId,
          eventId: e.eventId,
          sequence: e.sequence,
          ...genericNotice,
        },
      ].slice(-MAX_GROUPS);
    this.patch({ seen: remember(this.state.seen, e.eventId), groups });
  }
  sync = () => {
    const epoch = this.epoch;
    return this.flights.run(epoch, async () => {
      const i = this.state.identity;
      if (!i || !this.state.online) return;
      try {
        await this.hydrate();
        if (!this.state.ready || epoch !== this.epoch) return;
        this.backend.authorize(i);
        this.patch({ syncing: true, error: "" });
        let page;
        try {
          page = await this.backend.sync(i, this.state.cursor);
        } catch (e) {
          if (e instanceof Error && e.message === "Cursor ficticio no válido.")
            page = await this.backend.sync(i, 0);
          else throw e;
        }
        const current = () => {
          try {
            this.backend.authorize(i);
            return (
              epoch === this.epoch &&
              this.state.online &&
              this.scope() === this.scope(i)
            );
          } catch {
            return false;
          }
        };
        if (!current()) return;
        this.backend.authorize(i);
        // Recheck each current permission after the async boundary; remove revoked local groups.
        const groups = this.state.groups.filter((g) => {
          try {
            this.backend.authorize(i, g.conversationId);
            return this.backend.known(i, g.eventId).expiresAt > this.now();
          } catch {
            return false;
          }
        });
        this.patch({
          groups:
            groups.length === this.state.groups.length
              ? this.state.groups
              : groups,
        });
        const rows = page.conversations.filter((c) => {
          try {
            this.backend.authorize(i, c.id);
            return true;
          } catch {
            return false;
          }
        });
        await this.projection.apply(i, rows, current);
        if (!current()) return;
        this.backend.authorize(i);
        // Reconcile all missed messages but alert only on the newest unexpired event per conversation.
        const newest = new Map<string, Event>();
        for (const raw of page.events) {
          const e = decodeEvent(raw);
          if (
            this.backend.visible(i, e) &&
            fresh(e, this.now()) &&
            !this.state.seen.includes(e.eventId)
          ) {
            const old = newest.get(e.conversationId);
            if (!old || e.sequence > old.sequence)
              newest.set(e.conversationId, e);
          }
        }
        for (const e of newest.values()) this.accept(e);
        const seen = page.events.reduce(
          (list, e) => remember(list, e.eventId),
          this.state.seen,
        );
        this.patch({
          seen,
          cursor: page.cursor,
          result: "Sincronización ficticia completada",
        });
        await this.save();
      } catch (e) {
        if (epoch === this.epoch) {
          this.failure(e);
          try {
            this.backend.authorize(i);
          } catch {
            this.registration.revoke(this.state.online);
            this.patch({ groups: [], registered: false, pending: null });
          }
        }
      } finally {
        if (epoch === this.epoch) this.patch({ syncing: false });
      }
    });
  };
  tap = async (raw: unknown) => {
    try {
      const e = decodeEvent(raw);
      if (!eligible(e)) return;
      await this.hydrate();
      if (!this.state.ready) throw Error("Avisos locales no disponibles.");
      const same =
        this.state.pending?.eventId === e.eventId &&
        this.state.pending.organizationId === e.organizationId &&
        this.state.pending.conversationId === e.conversationId &&
        this.state.pending.expiresAt === e.expiresAt;
      if (!same)
        this.patch({
          pending: {
            eventId: e.eventId,
            organizationId: e.organizationId,
            conversationId: e.conversationId,
            expiresAt: e.expiresAt,
          },
        });
      await this.save();
      return await this.openPending();
    } catch (e) {
      this.failure(e);
      return "error";
    }
  };
  private opening = new Map<string, Promise<string>>();
  openPending = () => {
    const key = `${this.epoch}/${this.state.pending?.eventId ?? "none"}`;
    const prior = this.opening.get(key);
    if (prior) return prior;
    const work = this.performOpen()
      .catch((e) => {
        this.failure(e);
        return "error";
      })
      .finally(() => this.opening.delete(key));
    this.opening.set(key, work);
    return work;
  };
  private performOpen = async () => {
    const d = this.state.pending;
    if (!d) return "none";
    let status = checkDestination(
      d,
      this.state.identity,
      this.now(),
      this.backend,
      this.projection,
    );
    if (status === "expired" || status === "denied") {
      this.patch({
        pending: null,
        result:
          status === "expired"
            ? "Aviso caducado"
            : "Acceso denegado al destino",
      });
      await this.save();
      return status;
    }
    if (status !== "ready") {
      this.patch({
        result:
          status === "needs-session"
            ? "Inicia una sesión ficticia para continuar"
            : status === "needs-navigation"
              ? "Esperando a que la navegación esté lista"
              : "Cambia a la organización ficticia autorizada",
      });
      return status;
    }
    if (!this.state.online) {
      this.patch({ result: "Destino conservado sin conexión" });
      return "offline";
    }
    const epoch = this.epoch;
    await this.sync();
    if (epoch !== this.epoch || this.state.pending !== d) return "stale";
    status = checkDestination(
      d,
      this.state.identity,
      this.now(),
      this.backend,
      this.projection,
    );
    if (status !== "ready" || this.state.error)
      return status === "ready" ? "error" : status;
    if (this.state.opened.includes(d.eventId)) {
      this.patch({ pending: null, result: "Apertura duplicada descartada" });
      await this.save();
      return "duplicate";
    }
    const priorOpened = this.state.opened,
      priorGroups = this.state.groups;
    this.patch({
      opened: remember(this.state.opened, d.eventId),
      pending: null,
      groups: this.state.groups.filter(
        (g) =>
          g.organizationId !== d.organizationId ||
          g.conversationId !== d.conversationId,
      ),
      result: "Chat autorizado abierto",
    });
    try {
      await this.save();
    } catch (e) {
      if (epoch === this.epoch) {
        this.patch({ opened: priorOpened, groups: priorGroups, pending: d });
        this.failure(e);
      }
      return "error";
    }
    if (epoch !== this.epoch) return "stale";
    if (
      checkDestination(
        d,
        this.state.identity,
        this.now(),
        this.backend,
        this.projection,
      ) !== "ready"
    )
      return "denied";
    this.projection.open(d.conversationId);
    return "opened";
  };
}
