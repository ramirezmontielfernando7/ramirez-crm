import type { StoragePort } from "../../services/storage";
import type { TeamRepository } from "../team/core";
export const privacyLabels = [
  "El equipo puede ver mis chats «Es cliente»",
  "La IA de la empresa contesta mis chats «Es cliente»",
  "Mi IA (conector) puede leer y responder",
  "Supervisión de la coordinación",
] as const;
type Doc = Readonly<{
  schema: 1;
  organization: string;
  actor: string;
  privacy: readonly boolean[];
  linked: boolean;
  generation: number;
}>;
const queues = new WeakMap<TeamRepository, Map<string, Promise<unknown>>>();
export class PersonalStore {
  readonly key: string;
  private state: Readonly<{ ready: boolean; error: string; doc: Doc }>;
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  constructor(
    readonly team: TeamRepository,
    readonly actor: string,
    private io: StoragePort,
    private now = Date.now,
  ) {
    this.key = `dashfort.demo.personal.v1.${team.organizationId}.${actor}`;
    this.state = Object.freeze({
      ready: false,
      error: "",
      doc: this.freeze({
        schema: 1,
        organization: team.organizationId,
        actor,
        privacy: [false, false, false, false],
        linked: false,
        generation: 0,
      }),
    });
  }
  private freeze(d: Doc): Doc {
    return Object.freeze({ ...d, privacy: Object.freeze([...d.privacy]) });
  }
  private decode(raw: string): Doc {
    if (raw.length > 4000) throw Error("Datos locales no válidos.");
    const d = JSON.parse(raw);
    if (
      d.schema !== 1 ||
      d.organization !== this.team.organizationId ||
      d.actor !== this.actor ||
      !Array.isArray(d.privacy) ||
      d.privacy.length !== 4 ||
      d.privacy.some((v: unknown) => typeof v !== "boolean") ||
      typeof d.linked !== "boolean" ||
      !Number.isSafeInteger(d.generation) ||
      d.generation < 0
    )
      throw Error("Ámbito personal no válido.");
    return this.freeze(d);
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
  hydrate = () => {
    if (this.state.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        await this.team.hydrate();
        this.team.actor(this.actor);
        const raw = await this.io.get(this.key);
        this.team.actor(this.actor);
        this.patch({
          ready: true,
          error: "",
          doc: raw ? this.decode(raw) : this.state.doc,
        });
      } catch {
        this.patch({ ready: false, error: "No se pudo recuperar Mi número." });
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  };
  private change(fn: (d: Doc) => Doc) {
    let q = queues.get(this.team);
    if (!q) {
      q = new Map();
      queues.set(this.team, q);
    }
    const job = (q.get(this.key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!this.state.ready) throw Error("Recupera Mi número primero.");
        this.team.actor(this.actor);
        const raw = await this.io.get(this.key);
        const d = raw ? this.decode(raw) : this.state.doc;
        const next = this.decode(JSON.stringify(fn(d)));
        await this.io.set(this.key, JSON.stringify(next));
        this.team.actor(this.actor);
        this.patch({ doc: next, error: "" });
      });
    q.set(this.key, job);
    return job;
  }
  setPrivacy(index: number, value: boolean) {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index > 3 ||
      typeof value !== "boolean"
    )
      return Promise.reject(Error("Preferencia no válida."));
    return this.change((d) => ({
      ...d,
      privacy: d.privacy.map((v, i) => (i === index ? value : v)),
    }));
  }
  private ticket: { generation: number; expires: number } | null = null;
  renew() {
    this.team.actor(this.actor);
    if (!this.state.ready) throw Error("Recupera Mi número primero.");
    this.ticket = {
      generation: (this.ticket?.generation ?? this.state.doc.generation) + 1,
      expires: this.now() + 60000,
    };
    return this.ticket.expires;
  }
  expires() {
    return this.ticket?.expires ?? 0;
  }
  async link() {
    const ticket = this.ticket;
    if (!ticket || this.now() >= ticket.expires)
      throw Error("La muestra caducó. Renueva el código.");
    await this.change((d) => {
      if (this.ticket !== ticket || this.now() >= ticket.expires)
        throw Error("La muestra caducó.");
      return { ...d, linked: true, generation: ticket.generation };
    });
    this.ticket = null;
  }
}
