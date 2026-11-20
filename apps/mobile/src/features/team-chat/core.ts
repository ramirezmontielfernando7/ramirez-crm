import type { StoragePort } from "../../services/storage";
import type { TeamRepository } from "../team/core";
export type Room = Readonly<{
  id: string;
  name: string;
  kind: "direct" | "group" | "announcements";
  members: readonly string[];
  creator: string;
  revision: number;
}>;
export type Message = Readonly<{
  id: string;
  room: string;
  author: string;
  text: string;
  at: number;
  attachment?: Readonly<{ name: string; bytes: number }>;
  client?: string;
}>;
type Doc = Readonly<{
  schema: 1;
  revision?: number;
  supervisors?: readonly string[];
  audit?: readonly { actor: string; room: string; at: number }[];
  organizationId: string;
  sequence: number;
  rooms: readonly Room[];
  messages: readonly Message[];
  receipts: readonly { key: string; signature: string; result: string }[];
}>;
const peers = new WeakMap<TeamRepository, Set<TeamChatStore>>();
const queues = new WeakMap<TeamRepository, Map<string, Promise<unknown>>>();
const freeze = (d: Doc): Doc =>
  Object.freeze({
    ...d,
    supervisors: Object.freeze([...(d.supervisors ?? [])]),
    audit: Object.freeze((d.audit ?? []).map((a) => Object.freeze({ ...a }))),
    rooms: Object.freeze(
      d.rooms.map((r) =>
        Object.freeze({ ...r, members: Object.freeze([...r.members]) }),
      ),
    ),
    messages: Object.freeze(
      d.messages.map((m) =>
        Object.freeze({
          ...m,
          attachment: m.attachment
            ? Object.freeze({ ...m.attachment })
            : undefined,
        }),
      ),
    ),
    receipts: Object.freeze(d.receipts.map((r) => Object.freeze({ ...r }))),
  });
export class TeamChatStore {
  readonly key: string;
  private loading: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private state: Readonly<{ ready: boolean; error: string; doc: Doc }>;
  constructor(
    readonly team: TeamRepository,
    readonly actorId: string,
    private storage: StoragePort,
    private now = Date.now,
  ) {
    this.key = `dashfort.demo.team-chat.v1.${team.organizationId}`;
    this.state = Object.freeze({
      ready: false,
      error: "",
      doc: freeze({
        schema: 1,
        organizationId: team.organizationId,
        sequence: 0,
        rooms: [
          {
            id: "demo-room-announcements",
            kind: "announcements",
            name: "Avisos",
            members: [],
            creator: "demo-owner",
            revision: 1,
          },
          {
            id: "demo-room-sales",
            kind: "group",
            name: "Ventas",
            members: ["demo-owner", "demo-coordinator", "demo-advisor"],
            creator: "demo-owner",
            revision: 1,
          },
        ],
        messages: [
          {
            id: "demo-internal-seed",
            room: "demo-room-sales",
            author: "demo-coordinator",
            text: "¿Quién puede atender la consulta de hoy?",
            at: 1763553600000,
          },
        ],
        receipts: [],
      }),
    });
  }
  private supervisedRoom: string | null = null;
  private share(doc: Doc) {
    for (const peer of peers.get(this.team) ?? []) {
      if ((peer.snapshot().doc.revision ?? 0) <= (doc.revision ?? 0))
        peer.patch({ doc });
    }
  }
  permittedSupervision() {
    const actor = this.team.actor(this.actorId);
    return (
      actor.role !== "advisor" &&
      (this.state.doc.supervisors ?? []).includes(actor.id)
    );
  }
  supervisionRooms() {
    if (!this.permittedSupervision())
      throw Error("Sin permiso explícito de supervisión.");
    return this.state.doc.rooms.filter((r) => !this.visible(r));
  }
  supervised(id: string) {
    return this.supervisedRoom === id && this.permittedSupervision();
  }
  clearSupervision() {
    if (this.supervisedRoom) {
      this.supervisedRoom = null;
      this.patch({});
    }
  }
  private references = 0;
  retain() {
    this.references++;
    let p = peers.get(this.team);
    if (!p) {
      p = new Set();
      peers.set(this.team, p);
    }
    p.add(this);
    return () => {
      this.references--;
      if (!this.references) peers.get(this.team)?.delete(this);
    };
  }
  setSupervisors(ids: readonly string[], key: string) {
    const allowed = [...new Set(ids)];
    return this.change(key, ["supervisors", allowed], (d) => {
      if (
        this.team.actor(this.actorId).role !== "owner" ||
        allowed.some((id) => {
          const a = this.team.actor(id);
          return a.role === "advisor";
        })
      )
        throw Error(
          "Solo propietario delega supervisión a perfiles permitidos.",
        );
      return { doc: { ...d, supervisors: allowed }, result: "policy" };
    });
  }
  openSupervised(id: string, key: string) {
    return this.change(key, ["supervise", id], (d) => {
      const actor = this.team.actor(this.actorId);
      if (
        actor.role === "advisor" ||
        !(d.supervisors ?? []).includes(actor.id) ||
        !d.rooms.some((r) => r.id === id)
      )
        throw Error("Sin permiso explícito de supervisión.");
      return {
        doc: {
          ...d,
          audit: [
            ...(d.audit ?? []),
            { actor: actor.id, room: id, at: this.now() },
          ].slice(-100),
        },
        result: id,
      };
    }).then((value) => {
      this.supervisedRoom = id;
      this.patch({});
      return value;
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
  private decode(raw: string) {
    if (raw.length > 3000000) throw Error("Historial local demasiado grande.");
    const d = JSON.parse(raw) as Doc;
    if (
      !d ||
      d.schema !== 1 ||
      d.organizationId !== this.team.organizationId ||
      !Number.isSafeInteger(d.sequence) ||
      d.sequence < 0 ||
      !Array.isArray(d.rooms) ||
      d.rooms.length > 100 ||
      !Array.isArray(d.messages) ||
      d.messages.length > 500 ||
      !Array.isArray(d.receipts) ||
      d.receipts.length > 200
    )
      throw Error("Chat interno local no válido.");
    for (const r of d.rooms)
      if (
        !r ||
        !/^demo-room-[\w-]+$/.test(r.id) ||
        typeof r.name !== "string" ||
        !r.name.trim() ||
        r.name.length > 80 ||
        !["direct", "group", "announcements"].includes(r.kind) ||
        !Array.isArray(r.members) ||
        new Set(r.members).size !== r.members.length ||
        !r.members.every(
          (id: unknown) => typeof id === "string" && this.team.known(id),
        ) ||
        !this.team.known(r.creator) ||
        !Number.isSafeInteger(r.revision) ||
        r.revision < 1
      )
        throw Error("Conversación interna no válida.");
    for (const m of d.messages)
      if (
        !m ||
        typeof m.id !== "string" ||
        !d.rooms.some((r) => r.id === m.room) ||
        !this.team.known(m.author) ||
        typeof m.text !== "string" ||
        m.text.length > 4000 ||
        !Number.isFinite(m.at) ||
        (m.client !== undefined && !/^demo-(?:conv|new)-\d+$/.test(m.client)) ||
        (m.attachment &&
          (!m.attachment.name ||
            m.attachment.name.length > 100 ||
            !Number.isSafeInteger(m.attachment.bytes) ||
            m.attachment.bytes <= 0 ||
            m.attachment.bytes > 50 * 1024 * 1024))
      )
        throw Error("Mensaje interno no válido.");
    for (const rows of [d.rooms, d.messages])
      if (new Set(rows.map((x) => x.id)).size !== rows.length)
        throw Error("Identidades duplicadas.");
    for (const r of d.receipts)
      if (
        !r ||
        typeof r.key !== "string" ||
        r.key.length > 160 ||
        typeof r.signature !== "string" ||
        typeof r.result !== "string"
      )
        throw Error("Recibo interno no válido.");
    if (
      d.revision !== undefined &&
      (!Number.isSafeInteger(d.revision) || d.revision < 0)
    )
      throw Error("Revisión no válida.");
    if (
      d.supervisors !== undefined &&
      (!Array.isArray(d.supervisors) ||
        d.supervisors.length > 100 ||
        new Set(d.supervisors).size !== d.supervisors.length ||
        !d.supervisors.every((id: string) => this.team.known(id)))
    )
      throw Error("Permisos de supervisión no válidos.");
    if (
      d.audit !== undefined &&
      (!Array.isArray(d.audit) ||
        d.audit.length > 100 ||
        !d.audit.every(
          (a) =>
            this.team.known(a.actor) &&
            d.rooms.some((r) => r.id === a.room) &&
            Number.isFinite(a.at),
        ))
    )
      throw Error("Auditoría no válida.");
    return freeze(d);
  }
  hydrate = () => {
    let set = peers.get(this.team);
    if (!set) {
      set = new Set();
      peers.set(this.team, set);
    }
    set.add(this);
    if (this.state.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        await this.team.hydrate();
        this.team.actor(this.actorId);
        const raw = await this.storage.get(this.key);
        if (raw) {
          const incoming = this.decode(raw);
          if ((incoming.revision ?? 0) >= (this.state.doc.revision ?? 0))
            this.patch({ doc: incoming });
        }
        this.patch({ ready: true, error: "" });
      } catch {
        this.patch({
          ready: false,
          error: "No se pudo recuperar el chat interno local.",
        });
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  };
  async reload() {
    this.patch({ ready: false });
    await this.hydrate();
  }
  private visible(r: Room) {
    this.team.actor(this.actorId);
    return r.kind === "announcements" || r.members.includes(this.actorId);
  }
  title(r: Room) {
    if (r.kind !== "direct") return r.name;
    const ids = r.members.filter((id) => id !== this.actorId);
    return ids
      .map(
        (id) =>
          this.team.snapshot().doc.members.find((m) => m.id === id)?.name ??
          "Persona no disponible",
      )
      .join(" · ");
  }
  async draft(id: string) {
    this.get(id);
    const raw = await this.storage.get(
      `${this.key}.draft.${this.actorId}.${id}`,
    );
    this.get(id);
    if (raw === null) return "";
    if (raw.length > 4000) throw Error("Borrador local no válido.");
    return raw;
  }
  async saveDraft(id: string, text: string) {
    this.get(id);
    if (this.supervised(id)) throw Error("Supervisión de solo lectura.");
    if (text.length > 4000) throw Error("Borrador demasiado largo.");
    await this.storage.set(`${this.key}.draft.${this.actorId}.${id}`, text);
  }
  list() {
    return this.state.doc.rooms.filter((r) => this.visible(r));
  }
  get(id: string) {
    const r = this.state.doc.rooms.find((r) => r.id === id);
    if (!r || (!this.visible(r) && !this.supervised(id)))
      throw Error("No tienes acceso a esta conversación.");
    return r;
  }
  messages(id: string) {
    this.get(id);
    return this.state.doc.messages
      .filter((m) => m.room === id)
      .sort((a, b) => a.at - b.at);
  }
  private change(
    key: string,
    intent: unknown,
    fn: (d: Doc) => { doc: Doc; result: string },
  ) {
    if (!key || key.length > 160)
      return Promise.reject(Error("Identificador no válido."));
    let map = queues.get(this.team);
    if (!map) {
      map = new Map();
      queues.set(this.team, map);
    }
    const signature = JSON.stringify([this.actorId, intent]);
    const job = (map.get(this.key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!this.state.ready) throw Error("Recupera el chat primero.");
        this.team.actor(this.actorId);
        const raw = await this.storage.get(this.key),
          d = raw ? this.decode(raw) : this.state.doc,
          receipt = d.receipts.find((r) => r.key === key);
        if (receipt) {
          if (receipt.signature !== signature)
            throw Error("Identificador de otra operación.");
          this.patch({ doc: d, error: "" });
          return receipt.result;
        }
        const r = fn(d);
        const next = this.decode(
          JSON.stringify({
            ...r.doc,
            revision: (d.revision ?? 0) + 1,
            receipts: [
              ...d.receipts,
              { key, signature, result: r.result },
            ].slice(-200),
          }),
        );
        await this.storage.set(this.key, JSON.stringify(next));
        this.patch({ doc: next, error: "" });
        this.share(next);
        return r.result;
      });
    map.set(this.key, job);
    return job;
  }
  create(ids: readonly string[], name: string | null, key: string) {
    const members = [...new Set([this.actorId, ...ids])].sort();
    return this.change(key, ["create", members, name], (d) => {
      const actor = this.team.actor(this.actorId);
      if (
        (name === null && members.length !== 2) ||
        members.length < 2 ||
        members.length > 30 ||
        members.some((id) => !this.team.available(id))
      )
        throw Error("Elige personas activas.");
      if (
        name !== null &&
        (actor.role !== "owner" || !name.trim() || name.length > 80)
      )
        throw Error("Crear grupos requiere propietario y nombre válido.");
      const old =
        name === null
          ? d.rooms.find(
              (r) =>
                r.kind === "direct" &&
                JSON.stringify([...r.members].sort()) ===
                  JSON.stringify(members),
            )
          : null;
      if (old) return { doc: d, result: old.id };
      if (d.rooms.length >= 100) throw Error("Límite local de conversaciones.");
      const sequence = d.sequence + 1,
        id = `demo-room-${sequence}`;
      return {
        doc: {
          ...d,
          sequence,
          rooms: [
            ...d.rooms,
            {
              id,
              name:
                name?.trim() ??
                this.team.snapshot().doc.members.find((m) => m.id === ids[0])!
                  .name,
              kind: name === null ? "direct" : "group",
              members,
              creator: this.actorId,
              revision: 1,
            },
          ],
        },
        result: id,
      };
    });
  }
  send(
    id: string,
    text: string,
    key: string,
    attachment?: { name: string; bytes: number },
    client?: string,
  ) {
    const input = {
      text: text.trim(),
      attachment: attachment ? { ...attachment } : undefined,
      client,
    };
    return this.change(key, ["send", id, input], (d) => {
      const r = d.rooms.find((r) => r.id === id);
      if (
        !r ||
        this.supervised(id) ||
        !this.visible(r) ||
        (r.kind === "announcements" &&
          this.team.actor(this.actorId).role === "advisor")
      )
        throw Error("Esta conversación es de solo lectura.");
      if (!input.text && !input.attachment) throw Error("Escribe un mensaje.");
      if (input.text.length > 4000) throw Error("Máximo 4000 caracteres.");
      const sequence = d.sequence + 1,
        messageId = `demo-internal-${sequence}`;
      return {
        doc: {
          ...d,
          sequence,
          messages: [
            ...d.messages,
            {
              id: messageId,
              room: id,
              author: this.actorId,
              ...input,
              at: this.now(),
            },
          ].slice(-500),
        },
        result: messageId,
      };
    });
  }
  leave(id: string, member: string, key: string) {
    return this.change(key, ["leave", id, member], (d) => {
      const r = d.rooms.find((r) => r.id === id);
      if (
        !r ||
        r.kind !== "group" ||
        !r.members.includes(member) ||
        !this.visible(r) ||
        (member !== this.actorId && r.creator !== this.actorId)
      )
        throw Error("No puedes quitar a esta persona.");
      return {
        doc: {
          ...d,
          rooms: d.rooms.map((x) =>
            x.id === id
              ? {
                  ...x,
                  members: x.members.filter((m) => m !== member),
                  revision: x.revision + 1,
                }
              : x,
          ),
        },
        result: id,
      };
    });
  }
}
