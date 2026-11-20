import type { StoragePort } from "../../services/storage";
import type { TeamRepository } from "../team/core";
export const privacyLabels = [
  "El equipo puede ver mis chats «Es cliente»",
  "La IA de la empresa contesta mis chats «Es cliente»",
  "Mi IA (conector) puede leer y responder",
  "Supervisión de la coordinación",
] as const;
export type PersonalRoom = Readonly<{
  id: string;
  phone: string;
  name: string;
  private: boolean;
  archived: boolean;
  client: boolean;
  draft: string;
  messages: readonly Readonly<{ id: string; text: string; at: number }>[];
}>;
type Doc = Readonly<{
  rooms?: readonly PersonalRoom[];
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
    return Object.freeze({
      ...d,
      rooms: Object.freeze(
        (d.rooms ?? []).map((r) =>
          Object.freeze({
            ...r,
            messages: Object.freeze(
              r.messages.map((m) => Object.freeze({ ...m })),
            ),
          }),
        ),
      ),
      privacy: Object.freeze([...d.privacy]),
    });
  }
  private decode(raw: string): Doc {
    if (raw.length > 1500000) throw Error("Datos locales no válidos.");
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
    if (
      d.rooms !== undefined &&
      (!Array.isArray(d.rooms) ||
        d.rooms.length > 100 ||
        new Set(d.rooms.map((r: PersonalRoom) => r.id)).size !==
          d.rooms.length ||
        d.rooms.some(
          (r: PersonalRoom) =>
            !r ||
            !/^personal-1555010[0-9]{4}$/.test(r.id) ||
            r.id !== `personal-${r.phone.replace(/\D/g, "")}` ||
            typeof r.name !== "string" ||
            r.name.length > 80 ||
            typeof r.private !== "boolean" ||
            typeof r.archived !== "boolean" ||
            typeof r.client !== "boolean" ||
            typeof r.draft !== "string" ||
            r.draft.length > 4000 ||
            !Array.isArray(r.messages) ||
            r.messages.length > 200 ||
            new Set(r.messages.map((m) => m.id)).size !== r.messages.length ||
            r.messages.some(
              (m) =>
                typeof m.id !== "string" ||
                m.id.length > 160 ||
                typeof m.text !== "string" ||
                m.text.length > 4000 ||
                !Number.isFinite(m.at),
            ),
        ))
    )
      throw Error("Conversación personal no válida.");
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
  room(id: string) {
    this.team.actor(this.actor);
    if (!this.state.ready) throw Error("Recupera Mi número primero.");
    const r = this.state.doc.rooms?.find((r) => r.id === id);
    if (!r) throw Error("Chat personal no disponible.");
    return r;
  }
  async create(phone: string) {
    const digits = phone.replace(/\D/g, "");
    if (!/^1555010[0-9]{4}$/.test(digits))
      throw Error("Usa solo un número ficticio +1 555 010 XXXX.");
    const id = `personal-${digits}`;
    await this.change((d) => {
      if (!d.linked) throw Error("Vincula primero un dispositivo ficticio.");
      if (d.rooms?.some((r) => r.id === id)) return d;
      return {
        ...d,
        rooms: [
          ...(d.rooms ?? []),
          {
            id,
            phone: `+${digits}`,
            name: `Contacto ficticio ${digits.slice(-4)}`,
            private: true,
            archived: false,
            client: false,
            draft: "",
            messages: [],
          },
        ],
      };
    });
    return id;
  }
  private edit(id: string, fn: (r: PersonalRoom, d: Doc) => PersonalRoom) {
    return this.change((d) => {
      const r = d.rooms?.find((r) => r.id === id);
      if (!r) throw Error("Chat personal no disponible.");
      return { ...d, rooms: d.rooms!.map((x) => (x.id === id ? fn(r, d) : x)) };
    });
  }
  draft(id: string, text: string) {
    if (text.length > 4000)
      return Promise.reject(Error("Máximo 4000 caracteres."));
    return this.edit(id, (r) => ({ ...r, draft: text }));
  }
  send(id: string, text: string, key: string) {
    if (!key || key.length > 160 || !text.trim() || text.length > 4000)
      return Promise.reject(Error("Mensaje no válido."));
    return this.edit(id, (r, d) => {
      if (!d.linked || r.archived || r.client)
        throw Error("No puedes enviar en este chat.");
      const old = r.messages.find((m) => m.id === key);
      if (old) {
        if (old.text !== text.trim())
          throw Error("Identificador de otro mensaje.");
        return r;
      }
      return {
        ...r,
        draft: "",
        messages: [
          ...r.messages,
          { id: key, text: text.trim(), at: this.now() },
        ].slice(-200),
      };
    });
  }
  privacy(id: string, value: boolean) {
    if (typeof value !== "boolean")
      return Promise.reject(Error("Privacidad no válida."));
    return this.edit(id, (r) => {
      if (r.client) throw Error("La copia en Clientes ya fue autorizada.");
      return { ...r, private: value };
    });
  }
  archive(id: string, value: boolean) {
    return this.edit(id, (r) => ({ ...r, archived: value }));
  }
  convert(id: string) {
    return this.edit(id, (r, d) => {
      if (r.private || !d.privacy[0])
        throw Error(
          "Desactiva Privado y autoriza compartir clientes en Mi número.",
        );
      return { ...r, client: true };
    });
  }
  disconnect() {
    this.ticket = null;
    return this.change((d) => ({ ...d, linked: false }));
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
