import type { StoragePort } from "../../services/storage";
import type { TeamRepository } from "../team/core";
export const word = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");
type Doc = Readonly<{
  org: string;
  enabled: boolean;
  words: readonly string[];
  reply: string;
  events: readonly Readonly<{
    id: string;
    contact: string;
    at: number;
    reply: string;
  }>[];
}>;
const queues = new WeakMap<TeamRepository, Map<string, Promise<unknown>>>();
export class OptOutStore {
  readonly key: string;
  private state: Readonly<{ ready: boolean; error: string; doc: Doc }>;
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  constructor(
    readonly team: TeamRepository,
    readonly actor: string,
    private io: StoragePort,
  ) {
    this.key = `dashfort.demo.optout.v1.${team.organizationId}`;
    this.state = {
      ready: false,
      error: "",
      doc: this.freeze({
        org: team.organizationId,
        enabled: true,
        words: ["STOP", "BAJA", "CANCELAR", "NO MAS"],
        reply:
          "Listo, ya no te enviaremos más mensajes. Si fue un error, escríbenos.",
        events: [],
      }),
    };
  }
  private freeze(d: Doc): Doc {
    return Object.freeze({
      ...d,
      words: Object.freeze([...d.words]),
      events: Object.freeze(d.events.map((e) => Object.freeze({ ...e }))),
    });
  }
  private decode(raw: string): Doc {
    if (raw.length > 500000) throw Error("Documento demasiado grande.");
    const d = JSON.parse(raw);
    if (
      d.org !== this.team.organizationId ||
      typeof d.enabled !== "boolean" ||
      !Array.isArray(d.words) ||
      d.words.length > 30 ||
      new Set(d.words).size !== d.words.length ||
      d.words.some(
        (s: unknown) =>
          typeof s !== "string" || !s || s.length > 40 || word(s) !== s,
      ) ||
      typeof d.reply !== "string" ||
      !d.reply.trim() ||
      d.reply.length > 1000 ||
      !Array.isArray(d.events) ||
      d.events.length > 500 ||
      new Set(d.events.map((e: { id: string }) => e.id)).size !==
        d.events.length ||
      d.events.some(
        (e: { id: string; contact: string; at: number; reply: string }) =>
          !e ||
          typeof e.id !== "string" ||
          !e.id ||
          e.id.length > 120 ||
          !/^demo-(conv|new)-\d+$/.test(e.contact) ||
          !Number.isFinite(e.at) ||
          typeof e.reply !== "string" ||
          e.reply.length > 1000,
      )
    )
      throw Error("Bajas locales no válidas.");
    return this.freeze(d);
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
  hydrate = () => {
    if (this.state.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        await this.team.hydrate();
        this.team.actor(this.actor);
        const raw = await this.io.get(this.key);
        this.patch({
          ready: true,
          error: "",
          doc: raw ? this.decode(raw) : this.state.doc,
        });
      } catch {
        this.patch({
          ready: false,
          error: "No se pudieron recuperar las bajas.",
        });
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
        if (!this.state.ready)
          throw Error("Recupera la configuración primero.");
        if (this.team.actor(this.actor).role === "advisor")
          throw Error("Solo propietario o coordinador configura esta muestra.");
        const raw = await this.io.get(this.key),
          d = raw ? this.decode(raw) : this.state.doc,
          next = this.decode(JSON.stringify(fn(d)));
        await this.io.set(this.key, JSON.stringify(next));
        this.patch({ doc: next, error: "" });
      });
    q.set(this.key, job);
    return job;
  }
  enabled(v: boolean) {
    return this.change((d) => ({ ...d, enabled: v }));
  }
  add(s: string) {
    const w = word(s);
    return this.change((d) => ({ ...d, words: [...new Set([...d.words, w])] }));
  }
  remove(s: string) {
    return this.change((d) => ({
      ...d,
      words: d.words.filter((w) => w !== s),
    }));
  }
  reply(s: string) {
    return this.change((d) => ({ ...d, reply: s.trim() }));
  }
  simulate(id: string, contact: string, text: string) {
    return this.change((d) => {
      const existing = d.events.find((e) => e.id === id);
      if (existing) {
        if (existing.contact !== contact)
          throw Error("Evento de otro contacto.");
        return d;
      }
      if (!d.enabled || !d.words.includes(word(text))) return d;
      if (d.events.length >= 500)
        throw Error(
          "Límite de 500 bajas ficticias. Se conserva todo el historial.",
        );
      return {
        ...d,
        events: [...d.events, { id, contact, at: Date.now(), reply: d.reply }],
      };
    });
  }
}
