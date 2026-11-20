import type { StoragePort } from "../../services/storage";
import type { TeamRepository } from "../team/core";
import { roles, type Role } from "../../domain/access";
export const serverAddress = "https://dashfort.example.invalid/api/mcp";
export const kinds = [
  "message",
  "tag",
  "task",
  "transfer",
  "campaign",
] as const;
export type ActionKind = (typeof kinds)[number];
export const actionLabels: Record<ActionKind, string> = {
  message: "Simuló propuesta de mensaje",
  tag: "Simuló etiquetado",
  task: "Simuló propuesta de tarea",
  transfer: "Simuló exportación/importación",
  campaign: "Simuló propuesta de campaña",
};
export type Policy = Readonly<{
  enabled: boolean;
  roles: readonly Role[];
  dailyLimit: number;
  transfer: boolean;
  campaign: boolean;
}>;
export type Connection = Readonly<{
  id: string;
  actor: string;
  provider: "Claude" | "ChatGPT";
  name: string;
  role: Role;
  active: boolean;
}>;
export type Activity = Readonly<{
  id: string;
  actor: string;
  connection: string;
  kind: ActionKind;
  at: number;
}>;
type Doc = Readonly<{
  schema: 1;
  org: string;
  revision: number;
  sequence: number;
  policy: Policy;
  connections: readonly Connection[];
  activity: readonly Activity[];
}>;
const peers = new WeakMap<TeamRepository, Set<ConnectorStore>>(),
  queues = new WeakMap<TeamRepository, Map<string, Promise<unknown>>>();
const exact = (v: object, keys: readonly string[]) =>
  Object.keys(v).every((k) => keys.includes(k));
function freeze(d: Doc): Doc {
  return Object.freeze({
    ...d,
    policy: Object.freeze({
      ...d.policy,
      roles: Object.freeze([...d.policy.roles]),
    }),
    connections: Object.freeze(
      d.connections.map((c) => Object.freeze({ ...c })),
    ),
    activity: Object.freeze(d.activity.map((a) => Object.freeze({ ...a }))),
  });
}
export class ConnectorStore {
  readonly key: string;
  private state: Readonly<{ ready: boolean; error: string; doc: Doc }>;
  private loading: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  constructor(
    readonly team: TeamRepository,
    readonly actor: string,
    private io: StoragePort,
    private now = Date.now,
  ) {
    this.key = `dashfort.demo.ai-connector.v1.${team.organizationId}`;
    this.state = Object.freeze({
      ready: false,
      error: "",
      doc: freeze({
        schema: 1,
        org: team.organizationId,
        revision: 0,
        sequence: 0,
        policy: {
          enabled: true,
          roles: ["owner", "coordinator"],
          dailyLimit: 100,
          transfer: false,
          campaign: false,
        },
        connections: [],
        activity: [],
      }),
    });
  }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
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
  private references = 0;
  retain() {
    this.references++;
    let set = peers.get(this.team);
    if (!set) {
      set = new Set();
      peers.set(this.team, set);
    }
    set.add(this);
    return () => {
      this.references--;
      if (!this.references) set!.delete(this);
    };
  }
  private decode(raw: string): Doc {
    if (raw.length > 1000000)
      throw Error("Registro de prueba demasiado grande.");
    const d = JSON.parse(raw) as Doc,
      p = d?.policy;
    if (
      !d ||
      !exact(d, [
        "schema",
        "org",
        "revision",
        "sequence",
        "policy",
        "connections",
        "activity",
      ]) ||
      d.schema !== 1 ||
      d.org !== this.team.organizationId ||
      !Number.isSafeInteger(d.revision) ||
      d.revision < 0 ||
      !Number.isSafeInteger(d.sequence) ||
      d.sequence < 0 ||
      !p ||
      !exact(p, ["enabled", "roles", "dailyLimit", "transfer", "campaign"]) ||
      typeof p.enabled !== "boolean" ||
      typeof p.transfer !== "boolean" ||
      typeof p.campaign !== "boolean" ||
      !Array.isArray(p.roles) ||
      new Set(p.roles).size !== p.roles.length ||
      !p.roles.every((r) => roles.includes(r)) ||
      !Number.isInteger(p.dailyLimit) ||
      p.dailyLimit < 1 ||
      p.dailyLimit > 1000 ||
      !Array.isArray(d.connections) ||
      d.connections.length > 200 ||
      !Array.isArray(d.activity) ||
      d.activity.length > 2000
    )
      throw Error("Conector ficticio no válido.");
    for (const c of d.connections)
      if (
        !c ||
        !exact(c, ["id", "actor", "provider", "name", "role", "active"]) ||
        !/^demo-ai-connection-\d+$/.test(c.id) ||
        !this.team.known(c.actor) ||
        !["Claude", "ChatGPT"].includes(c.provider) ||
        typeof c.name !== "string" ||
        !c.name.trim() ||
        c.name.length > 40 ||
        !roles.includes(c.role) ||
        typeof c.active !== "boolean"
      )
        throw Error("Conexión ficticia no válida.");
    if (
      new Set(d.connections.map((c) => c.id)).size !== d.connections.length ||
      new Set(
        d.connections
          .filter((c) => c.active)
          .map((c) => c.actor + ":" + c.provider),
      ).size !== d.connections.filter((c) => c.active).length ||
      new Set(d.activity.map((a) => a.id)).size !== d.activity.length
    )
      throw Error("Identidad duplicada.");
    for (const a of d.activity)
      if (
        !a ||
        !exact(a, ["id", "actor", "connection", "kind", "at"]) ||
        typeof a.id !== "string" ||
        !a.id ||
        a.id.length > 120 ||
        !this.team.known(a.actor) ||
        !d.connections.some(
          (c) => c.id === a.connection && c.actor === a.actor,
        ) ||
        !kinds.includes(a.kind) ||
        !Number.isFinite(a.at) ||
        a.at < 0 ||
        a.at > 8640000000000000
      )
        throw Error("Actividad ficticia no válida.");
    return freeze(d);
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
        if (doc.revision >= this.state.doc.revision) this.patch({ doc });
        this.patch({ ready: true, error: "" });
      } catch {
        this.patch({
          ready: false,
          error: "No se pudo recuperar el conector de prueba.",
        });
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  };
  private check() {
    if (!this.state.ready) throw Error("Recupera primero la configuración.");
    return this.team.actor(this.actor);
  }
  ownConnections() {
    this.check();
    return this.state.doc.connections.filter((c) => c.actor === this.actor);
  }
  ownActivity() {
    this.check();
    return this.state.doc.activity
      .filter((a) => a.actor === this.actor)
      .slice()
      .sort((a, b) => b.at - a.at);
  }
  usedToday() {
    return this.ownActivity().filter(
      (a) =>
        new Date(a.at).toISOString().slice(0, 10) ===
        new Date(this.now()).toISOString().slice(0, 10),
    ).length;
  }
  reason(id: string) {
    try {
      this.permitted(this.state.doc, id);
      return "";
    } catch (e) {
      return e instanceof Error ? e.message : "No autorizada";
    }
  }
  private permitted(d: Doc, id?: string) {
    const actor = this.check(),
      p = d.policy;
    if (!p.enabled || !p.roles.includes(actor.role))
      throw Error("El conector no está permitido para tu rol.");
    if (id) {
      const c = d.connections.find(
        (c) => c.id === id && c.actor === this.actor,
      );
      if (!c || !c.active || c.role !== actor.role)
        throw Error("Conexión revocada o requiere reautorizar.");
    }
    return actor;
  }
  private change<T>(fn: (d: Doc) => { doc: Doc; result: T }): Promise<T> {
    let q = queues.get(this.team);
    if (!q) {
      q = new Map();
      queues.set(this.team, q);
    }
    const job = (q.get(this.key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        this.check();
        const raw = await this.io.get(this.key),
          d = raw ? this.decode(raw) : this.state.doc;
        const { doc, result } = fn(d);
        const next = this.decode(
          JSON.stringify({ ...doc, revision: d.revision + 1 }),
        );
        await this.io.set(this.key, JSON.stringify(next));
        this.patch({ doc: next, error: "" });
        for (const peer of peers.get(this.team) ?? []) {
          if (peer.state.doc.revision <= next.revision)
            peer.patch({ doc: next });
        }
        return result;
      });
    q.set(this.key, job);
    return job;
  }
  configure(policy: Policy, expected: number) {
    const copy = { ...policy, roles: [...policy.roles] };
    return this.change((d) => {
      if (this.team.actor(this.actor).role !== "owner")
        throw Error("Solo propietario configura el conector del equipo.");
      if (d.revision !== expected)
        throw Error("La configuración cambió. Recarga y vuelve a guardar.");
      return { doc: { ...d, policy: copy }, result: undefined };
    });
  }
  connect(provider: Connection["provider"], name: string) {
    return this.change((d) => {
      const actor = this.permitted(d);
      if (!["Claude", "ChatGPT"].includes(provider))
        throw Error("Proveedor ficticio no válido.");
      const existing = d.connections.find(
        (c) =>
          c.actor === this.actor &&
          c.provider === provider &&
          c.active &&
          c.role === actor.role,
      );
      if (existing) return { doc: d, result: existing.id };
      if (d.connections.length >= 200)
        throw Error("Límite local de conexiones; historial conservado.");
      const sequence = d.sequence + 1,
        id = `demo-ai-connection-${sequence}`;
      return {
        doc: {
          ...d,
          sequence,
          connections: [
            ...d.connections.map((c) =>
              c.actor === this.actor && c.provider === provider
                ? { ...c, active: false }
                : c,
            ),
            {
              id,
              actor: this.actor,
              provider,
              name: name.trim(),
              role: actor.role,
              active: true,
            },
          ],
        },
        result: id,
      };
    });
  }
  rename(id: string, name: string) {
    return this.change((d) => {
      if (!d.connections.some((c) => c.id === id && c.actor === this.actor))
        throw Error("Conexión ajena.");
      return {
        doc: {
          ...d,
          connections: d.connections.map((c) =>
            c.id === id ? { ...c, name: name.trim() } : c,
          ),
        },
        result: undefined,
      };
    });
  }
  revoke(id: string) {
    return this.change((d) => {
      if (!d.connections.some((c) => c.id === id && c.actor === this.actor))
        throw Error("Conexión ajena.");
      return {
        doc: {
          ...d,
          connections: d.connections.map((c) =>
            c.id === id ? { ...c, active: false } : c,
          ),
        },
        result: undefined,
      };
    });
  }
  simulate(id: string, kind: ActionKind, eventId: string) {
    return this.change((d) => {
      const actor = this.permitted(d, id);
      if (!kinds.includes(kind) || !eventId || eventId.length > 120)
        throw Error("Acción ficticia no válida.");
      if (
        (kind === "transfer" &&
          (!d.policy.transfer || actor.role === "advisor")) ||
        (kind === "campaign" &&
          (!d.policy.campaign || actor.role === "advisor"))
      )
        throw Error("Función avanzada no permitida.");
      const prior = d.activity.find((a) => a.id === eventId);
      if (prior) {
        if (
          prior.actor !== this.actor ||
          prior.connection !== id ||
          prior.kind !== kind
        )
          throw Error("Identificador de otra acción.");
        return { doc: d, result: prior };
      }
      const at = this.now(),
        day = new Date(at).toISOString().slice(0, 10);
      if (
        d.activity.filter(
          (a) =>
            a.actor === this.actor &&
            new Date(a.at).toISOString().slice(0, 10) === day,
        ).length >= d.policy.dailyLimit
      )
        throw Error("Tope diario ficticio alcanzado.");
      if (d.activity.length >= 2000)
        throw Error("Registro local completo; historial conservado.");
      const action = {
        id: eventId,
        actor: this.actor,
        connection: id,
        kind,
        at,
      };
      return {
        doc: { ...d, activity: [...d.activity, action] },
        result: action,
      };
    });
  }
}
