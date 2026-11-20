import type { StoragePort } from "../../services/storage";
import type { TeamRepository } from "../team/core";
import type { Mode } from "../contact/model";
export type ChannelDoc = Readonly<{
  org: string;
  revision: number;
  status: "disconnected" | "incomplete" | "connected";
  quality: "Alta" | "Media" | "Baja";
  addon: boolean;
  device: boolean;
  defaultMode: Mode;
  epoch: number;
  bulkMode: Mode;
  ads: boolean;
  events: readonly { id: string; kind: "Lead" | "Compra"; click: string }[];
}>;
const peers = new WeakMap<TeamRepository, Set<ChannelStore>>();
const queues = new WeakMap<TeamRepository, Map<string, Promise<unknown>>>();
export class ChannelStore {
  readonly key: string;
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private state: Readonly<{ ready: boolean; error: string; doc: ChannelDoc }>;
  constructor(
    readonly team: TeamRepository,
    readonly actor: string,
    private io: StoragePort,
    private apply: (d: ChannelDoc) => void = () => {},
    private now = Date.now,
  ) {
    this.key = `dashfort.demo.channels.v1.${team.organizationId}`;
    this.state = {
      ready: false,
      error: "",
      doc: this.freeze({
        org: team.organizationId,
        revision: 0,
        status: "disconnected",
        quality: "Alta",
        addon: false,
        device: false,
        defaultMode: "meta",
        epoch: 0,
        bulkMode: "meta",
        ads: false,
        events: [],
      }),
    };
  }
  private freeze(d: ChannelDoc) {
    return Object.freeze({
      ...d,
      events: Object.freeze(d.events.map((e) => Object.freeze({ ...e }))),
    });
  }
  snapshot = () => this.state;
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  private patch(p: Partial<typeof this.state>) {
    this.state = Object.freeze({ ...this.state, ...p });
    this.listeners.forEach((f) => {
      try {
        f();
      } catch {}
    });
  }
  private decode(raw: string): ChannelDoc {
    if (raw.length > 200000) throw Error("Canales locales demasiado grandes.");
    const d = JSON.parse(raw);
    if (
      !d ||
      d.org !== this.team.organizationId ||
      Object.keys(d).some(
        (k) =>
          ![
            "org",
            "revision",
            "status",
            "quality",
            "addon",
            "device",
            "defaultMode",
            "epoch",
            "bulkMode",
            "ads",
            "events",
          ].includes(k),
      ) ||
      !Number.isSafeInteger(d.revision) ||
      d.revision < 0 ||
      !Number.isSafeInteger(d.epoch) ||
      d.epoch < 0 ||
      !["disconnected", "incomplete", "connected"].includes(d.status) ||
      !["Alta", "Media", "Baja"].includes(d.quality) ||
      typeof d.addon !== "boolean" ||
      typeof d.device !== "boolean" ||
      typeof d.ads !== "boolean" ||
      (!d.addon && d.device) ||
      !["meta", "direct", "hybrid"].includes(d.defaultMode) ||
      !["meta", "direct", "hybrid"].includes(d.bulkMode) ||
      ((!d.device || !d.addon) &&
        (d.defaultMode !== "meta" || d.bulkMode !== "meta")) ||
      !Array.isArray(d.events) ||
      d.events.length > 500 ||
      new Set(d.events.map((e: { id: string }) => e.id)).size !==
        d.events.length ||
      d.events.some(
        (e: { id: string; kind: string; click: string }) =>
          !e ||
          typeof e.id !== "string" ||
          !e.id ||
          e.id.length > 120 ||
          !["Lead", "Compra"].includes(e.kind) ||
          !/^demo-ctwa-[a-z0-9-]{1,60}$/.test(e.click) ||
          Object.keys(e).some((k) => !["id", "kind", "click"].includes(k)),
      )
    )
      throw Error("Configuración ficticia no válida.");
    return this.freeze(d);
  }
  private refs = 0;
  retain() {
    this.refs++;
    let s = peers.get(this.team);
    if (!s) {
      s = new Set();
      peers.set(this.team, s);
    }
    s.add(this);
    return () => {
      if (--this.refs === 0) s!.delete(this);
    };
  }
  private manage() {
    const a = this.team.actor(this.actor);
    if (a.role === "advisor") throw Error("Tu rol no administra canales.");
    return a;
  }
  hydrate = () => {
    if (this.state.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        await this.team.hydrate();
        this.team.actor(this.actor);
        const raw = await this.io.get(this.key),
          doc = raw ? this.decode(raw) : this.state.doc;
        const latest =
          doc.revision >= this.state.doc.revision ? doc : this.state.doc;
        this.apply(latest);
        this.patch({ ready: true, error: "", doc: latest });
      } catch {
        this.patch({
          ready: false,
          error: "No se pudo recuperar la configuración de canales.",
        });
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  };
  private change(fn: (d: ChannelDoc) => ChannelDoc) {
    let q = queues.get(this.team);
    if (!q) {
      q = new Map();
      queues.set(this.team, q);
    }
    const job = (q.get(this.key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        this.manage();
        if (!this.state.ready) throw Error("Recupera canales primero.");
        const raw = await this.io.get(this.key),
          d = raw ? this.decode(raw) : this.state.doc,
          next = this.decode(
            JSON.stringify({ ...fn(d), revision: d.revision + 1 }),
          );
        await this.io.set(this.key, JSON.stringify(next));
        this.manage();
        this.apply(next);
        this.patch({ doc: next, error: "" });
        for (const p of peers.get(this.team) ?? []) {
          if (p.state.doc.revision <= next.revision)
            try {
              p.apply(next);
              p.patch({ doc: next });
            } catch {
              p.patch({ ready: false, error: "Recupera la configuración." });
            }
        }
      });
    q.set(this.key, job);
    return job;
  }
  connect(result: "success" | "missing" | "cancel") {
    return this.change((d) => {
      if (!["success", "missing", "cancel"].includes(result))
        throw Error("Resultado ficticio no válido.");
      return result === "cancel"
        ? d
        : { ...d, status: result === "success" ? "connected" : "incomplete" };
    });
  }
  disconnect() {
    return this.change((d) => ({ ...d, status: "disconnected" }));
  }
  addon(value: boolean) {
    return this.change((d) => {
      if (this.manage().role !== "owner")
        throw Error(
          "Solo el laboratorio de propietario cambia el complemento ficticio.",
        );
      return {
        ...d,
        addon: value,
        device: value ? d.device : false,
        defaultMode: value ? d.defaultMode : "meta",
        bulkMode: value ? d.bulkMode : "meta",
        epoch: value ? d.epoch : d.epoch + 1,
      };
    });
  }
  private expires = 0;
  renew() {
    this.manage();
    if (!this.state.ready || !this.state.doc.addon)
      throw Error("Complemento no disponible.");
    this.expires = this.now() + 60000;
  }
  link() {
    return this.change((d) => {
      if (!d.addon || this.now() >= this.expires)
        throw Error("La muestra caducó. Renueva la vinculación ficticia.");
      return { ...d, device: true };
    }).then(() => {
      this.expires = 0;
    });
  }
  mode(mode: Mode) {
    return this.change((d) => {
      if (!d.addon) throw Error("Complemento no disponible.");
      if (mode !== "meta" && !d.device)
        throw Error("Vincula primero un dispositivo ficticio.");
      return { ...d, defaultMode: mode };
    });
  }
  bulk() {
    return this.change((d) => {
      if (this.manage().role !== "owner")
        throw Error("Solo propietario aplica a todos.");
      if (!d.addon || (d.defaultMode !== "meta" && !d.device))
        throw Error("Conexión directa no disponible.");
      return { ...d, epoch: d.epoch + 1, bulkMode: d.defaultMode };
    });
  }
  quality(quality: ChannelDoc["quality"]) {
    return this.change((d) => ({ ...d, quality }));
  }
  ads(value: boolean) {
    return this.change((d) => {
      if (this.manage().role !== "owner")
        throw Error("Solo propietario configura atribución.");
      return { ...d, ads: value };
    });
  }
  report(id: string, kind: "Lead" | "Compra", click: string) {
    return this.change((d) => {
      if (!d.ads) throw Error("Atribución ficticia apagada.");
      const old = d.events.find((e) => e.id === id);
      if (old) {
        if (old.kind !== kind || old.click !== click)
          throw Error("Identificador de otro evento.");
        return d;
      }
      if (d.events.length >= 500)
        throw Error("Registro lleno; historial conservado.");
      return { ...d, events: [...d.events, { id, kind, click }] };
    });
  }
}
