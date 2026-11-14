import {
  decodeEvent,
  eligible,
  ORG_A,
  type Event,
  type Identity,
} from "./model";
import { NotificationStore } from "./core";
import { DemoNotificationBackend } from "./adapters/demo";
import type { StoragePort } from "./ports";
export type LocalPermission =
  "granted" | "denied" | "undetermined" | "channel-blocked" | "unsupported";
export interface LocalPort {
  permission(request?: boolean): Promise<LocalPermission>;
  schedule(
    id: string,
    eventId: string,
    group: string,
    seconds: number,
  ): Promise<void>;
  cancel(id: string): Promise<void>;
}
type Record = { owner: string; event: Event; scheduled: boolean };
const key = "dashfort.demo.local-notifications.v1";
export const localId = (e: Event) =>
  `dashfort-local-${e.organizationId}-${e.conversationId}`;
export class LocalNotifications {
  private rows: Record[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private loaded = false;
  private status = {
    permission: "undetermined" as LocalPermission,
    result: "",
    ready: false,
  };
  private listeners = new Set<() => void>();
  constructor(
    readonly store: NotificationStore,
    readonly port: LocalPort,
    readonly storage: StoragePort,
    readonly now = Date.now,
  ) {}
  failure = (e: unknown) =>
    this.patch({
      result: e instanceof Error ? e.message : "Error de avisos locales",
    });
  snapshot = () => this.status;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private patch(p: Partial<typeof this.status>) {
    this.status = { ...this.status, ...p };
    this.listeners.forEach((f) => f());
  }
  private work<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn);
    this.queue = p.catch(() => {});
    return p;
  }
  private save() {
    return this.storage.set(
      key,
      JSON.stringify({ version: 1, rows: this.rows }),
    );
  }
  hydrate = () =>
    this.work(async () => {
      if (this.loaded) return;
      const raw = await this.storage.get(key);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.version !== 1 || !Array.isArray(d.rows) || d.rows.length > 128)
          throw Error("Registro local no válido.");
        this.rows = d.rows.map((r: Record) => {
          if (
            !["demo-owner", "demo-coordinator", "demo-advisor"].includes(
              r.owner,
            ) ||
            typeof r.scheduled !== "boolean"
          )
            throw Error("Perfil local no válido.");
          const e = decodeEvent(r.event);
          // Only a persisted local sample can become canonical on process restart.
          const {
            eventId,
            organizationId,
            conversationId,
            kind,
            occurredAt,
            expiresAt,
          } = e;
          const event = (this.store.backend as DemoNotificationBackend).publish(
            {
              eventId,
              organizationId,
              conversationId,
              kind,
              occurredAt,
              expiresAt,
            },
          );
          return { owner: r.owner, scheduled: r.scheduled, event };
        });
      }
      this.loaded = true;
      this.patch({ ready: true });
    });
  private allowed(r: Record, i: Identity | null) {
    return (
      !!i &&
      r.owner === i.userId &&
      r.event.organizationId === i.organizationId &&
      r.event.organizationId === ORG_A &&
      eligible(r.event) &&
      r.event.expiresAt > this.now() &&
      r.event.occurredAt <= this.now() &&
      this.store.backend.visible(i, r.event) &&
      this.store.projection.canOpen(i, r.event.conversationId)
    );
  }
  permission = (request = false) =>
    this.work(async () => {
      const permission = await this.port.permission(request);
      this.patch({ permission });
      if (permission !== "granted")
        for (const r of this.rows) await this.port.cancel(localId(r.event));
      return permission;
    });
  reconcile = () =>
    this.work(async () => {
      if (!this.loaded) return;
      const i = this.store.snapshot().identity;
      const invalid = this.rows.filter((r) => !this.allowed(r, i));
      for (const r of invalid) await this.port.cancel(localId(r.event));
      if (invalid.length) {
        this.rows = this.rows.filter((r) => this.allowed(r, i));
        await this.save();
      }
    });
  send = (event: Event, seconds = 1) =>
    this.work(async () => {
      if (!this.loaded) throw Error("Espera la recuperación del laboratorio.");
      if (![1, 15].includes(seconds))
        throw Error("Demora de prueba no válida.");
      const e = decodeEvent(event),
        i = this.store.snapshot().identity;
      const r: Record = { owner: i?.userId ?? "", event: e, scheduled: false };
      if (!this.allowed(r, i))
        throw Error("Aviso local fuera del alcance autorizado.");
      const canonical = this.store.backend.known(i!, e.eventId);
      if (JSON.stringify(canonical) !== JSON.stringify(e))
        throw Error("Evento local alterado.");
      const permission = await this.port.permission();
      this.patch({ permission });
      if (permission !== "granted") {
        this.patch({
          result: "Sin permiso local; la aplicación sigue disponible",
        });
        return "denied";
      }
      if (!this.allowed(r, this.store.snapshot().identity)) return "stale";
      if (
        this.rows.some(
          (x) =>
            x.event.eventId === e.eventId && x.owner === r.owner && x.scheduled,
        )
      )
        return "duplicate";
      if (
        !this.rows.some(
          (x) => x.event.eventId === e.eventId && x.owner === r.owner,
        )
      ) {
        if (this.rows.length >= 128)
          throw Error("Límite de muestras: limpia los avisos locales.");
        this.rows.push(r);
      }
      // Write before scheduling; deterministic native ID makes uncertain retries replace the same notice.
      await this.save();
      await this.port.schedule(
        localId(e),
        e.eventId,
        `${e.organizationId}/${e.conversationId}`,
        seconds,
      );
      if (!this.allowed(r, this.store.snapshot().identity)) {
        await this.port.cancel(localId(e));
        return "stale";
      }
      this.rows = this.rows.map((x) =>
        x.event.eventId === e.eventId ? { ...x, scheduled: true } : x,
      );
      await this.save();
      this.patch({
        result: `Aviso local programado (${seconds} s, tiempo aproximado)`,
      });
      return "scheduled";
    });
  tap = (id: unknown) =>
    this.work(async () => {
      if (typeof id !== "string") return "invalid";
      const r = this.rows.find((x) => x.event.eventId === id);
      if (!r || !this.allowed(r, this.store.snapshot().identity))
        return "denied";
      const result = await this.store.tap(r.event);
      if (result === "opened" || result === "duplicate")
        await this.port.cancel(localId(r.event));
      this.patch({ result: `Apertura local: ${result}` });
      return result;
    });
  clear = () =>
    this.work(async () => {
      for (const r of this.rows) await this.port.cancel(localId(r.event));
      this.rows = [];
      await this.save();
      this.loaded = true;
      this.patch({ ready: true, result: "Avisos locales retirados" });
    });
}
