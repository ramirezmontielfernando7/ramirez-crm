import type { StoragePort } from "../../services/storage";
export type TeamRole = "owner" | "coordinator" | "advisor";
export type Member = Readonly<{
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  active: boolean;
  receiveNew: boolean;
  revision: number;
}>;
export type Invitation = Readonly<{
  id: string;
  memberId: string;
  status: "pending" | "accepted" | "revoked";
  expiresAt: number;
}>;
type Doc = Readonly<{
  schema: 1;
  organizationId: string;
  revision: number;
  sequence: number;
  members: readonly Member[];
  invitations: readonly Invitation[];
  receipts: readonly { key: string; signature: string; result: string }[];
}>;
type IO = Pick<StoragePort, "get" | "set">;
const queues = new WeakMap<IO, Map<string, Promise<unknown>>>();
const roles: readonly string[] = ["owner", "coordinator", "advisor"];
const freeze = (d: Doc): Doc =>
  Object.freeze({
    ...d,
    members: Object.freeze(d.members.map((m) => Object.freeze({ ...m }))),
    invitations: Object.freeze(
      d.invitations.map((i) => Object.freeze({ ...i })),
    ),
    receipts: Object.freeze(d.receipts.map((r) => Object.freeze({ ...r }))),
  });
/** Isolated demo foundation. Not an authentication authority or an email sender. */
export class TeamRepository {
  readonly key: string;
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private state: Readonly<{ ready: boolean; error: string; doc: Doc }>;
  constructor(
    readonly organizationId: string,
    private storage: IO,
    private now = Date.now,
  ) {
    if (!/^demo-org-[\w-]{1,60}$/.test(organizationId))
      throw Error("Organización ficticia no válida.");
    this.key = `dashfort.demo.team.v1.${organizationId}`;
    this.state = Object.freeze({
      ready: false,
      error: "",
      doc: freeze({
        schema: 1,
        organizationId,
        revision: 0,
        sequence: 0,
        members: [
          {
            id: "demo-owner",
            name: "Fer Ramírez",
            email: "owner@example.test",
            role: "owner",
            active: true,
            receiveNew: true,
            revision: 1,
          },
          {
            id: "demo-coordinator",
            name: "Ana López",
            email: "coordinator@example.test",
            role: "coordinator",
            active: true,
            receiveNew: true,
            revision: 1,
          },
          {
            id: "demo-advisor",
            name: "Luis Ortega",
            email: "advisor@example.test",
            role: "advisor",
            active: true,
            receiveNew: true,
            revision: 1,
          },
        ],
        invitations: [],
        receipts: [],
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
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {}
    }
  }
  private decode(raw: string) {
    if (raw.length > 500000) throw Error("Equipo local demasiado grande.");
    const d = JSON.parse(raw) as Doc;
    if (
      !d ||
      d.schema !== 1 ||
      d.organizationId !== this.organizationId ||
      !Number.isSafeInteger(d.revision) ||
      d.revision < 0 ||
      !Number.isSafeInteger(d.sequence) ||
      d.sequence < 0 ||
      !Array.isArray(d.members) ||
      d.members.length > 100 ||
      !Array.isArray(d.invitations) ||
      d.invitations.length > 100 ||
      !Array.isArray(d.receipts) ||
      d.receipts.length > 100
    )
      throw Error("Equipo local no válido.");
    const ids = new Set<string>(),
      emails = new Set<string>();
    for (const m of d.members) {
      if (
        !m ||
        typeof m.id !== "string" ||
        !/^demo-[\w-]{1,80}$/.test(m.id) ||
        ids.has(m.id) ||
        typeof m.name !== "string" ||
        !m.name.trim() ||
        m.name.length > 100 ||
        typeof m.email !== "string" ||
        !/^[-a-z0-9._+]+@example\.test$/.test(m.email) ||
        emails.has(m.email) ||
        !roles.includes(m.role) ||
        typeof m.active !== "boolean" ||
        typeof m.receiveNew !== "boolean" ||
        !Number.isSafeInteger(m.revision) ||
        m.revision < 1
      )
        throw Error("Persona ficticia no válida.");
      ids.add(m.id);
      emails.add(m.email);
    }
    if (!d.members.some((m) => m.active && m.role === "owner"))
      throw Error("Debe permanecer un propietario activo.");
    const invitationIds = new Set<string>();
    for (const i of d.invitations) {
      if (
        !i ||
        !/^demo-invite-\d+$/.test(i.id) ||
        invitationIds.has(i.id) ||
        !ids.has(i.memberId) ||
        !["pending", "accepted", "revoked"].includes(i.status) ||
        !Number.isSafeInteger(i.expiresAt) ||
        i.expiresAt < 0
      )
        throw Error("Invitación ficticia no válida.");
      invitationIds.add(i.id);
    }
    const pending = new Set<string>();
    for (const i of d.invitations.filter((i) => i.status === "pending")) {
      if (pending.has(i.memberId))
        throw Error("Invitación pendiente duplicada.");
      pending.add(i.memberId);
    }
    const keys = new Set<string>();
    for (const r of d.receipts) {
      if (
        !r ||
        typeof r.key !== "string" ||
        !r.key ||
        r.key.length > 160 ||
        keys.has(r.key) ||
        typeof r.signature !== "string" ||
        r.signature.length > 2000 ||
        typeof r.result !== "string"
      )
        throw Error("Recibo local no válido.");
      keys.add(r.key);
    }
    return freeze(d);
  }
  hydrate = () => {
    if (this.state.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const raw = await this.storage.get(this.key);
        if (raw) this.patch({ doc: this.decode(raw) });
        this.patch({ ready: true, error: "" });
      } catch {
        this.patch({
          ready: false,
          error: "No se pudo recuperar el equipo local. No se sobrescribió.",
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
  actor(id: string) {
    if (!this.state.ready)
      throw Error("Recupera el equipo antes de continuar.");
    const m = this.state.doc.members.find((m) => m.id === id && m.active);
    if (!m) throw Error("El acceso de esta persona está desactivado.");
    return { id: m.id, role: m.role };
  }
  known(id: string) {
    return this.state.doc.members.some((m) => m.id === id);
  }
  available(id: string) {
    return (
      this.state.ready &&
      this.state.doc.members.some((m) => m.id === id && m.active)
    );
  }
  people() {
    return this.state.doc.members.filter((m) => m.active);
  }
  seats() {
    return this.state.doc.members.filter(
      (m) =>
        m.active ||
        this.state.doc.invitations.some(
          (i) =>
            i.memberId === m.id &&
            i.status === "pending" &&
            i.expiresAt > this.now(),
        ),
    ).length;
  }
  reissue(actor: string, id: string, key: string) {
    return this.change(key, ["reissue", actor, id], (d) => {
      this.manage(d, actor);
      const i = d.invitations.find((i) => i.id === id);
      if (
        !i ||
        i.status === "accepted" ||
        d.members.find((m) => m.id === i.memberId)?.active
      )
        throw Error("La invitación no se puede reemitir.");
      if (d.invitations.length >= 100) throw Error("Límite local alcanzado.");
      const occupied = d.members.filter(
        (m) =>
          m.active ||
          d.invitations.some(
            (x) =>
              x.memberId === m.id &&
              x.memberId !== i.memberId &&
              x.status === "pending" &&
              x.expiresAt > this.now(),
          ),
      ).length;
      if (occupied >= 5) throw Error("Sin plazas en el plan ficticio.");
      const sequence = d.sequence + 1,
        nextId = `demo-invite-${sequence}`;
      return {
        doc: {
          ...d,
          sequence,
          invitations: [
            ...d.invitations.map((x) =>
              x.memberId === i.memberId && x.status === "pending"
                ? { ...x, status: "revoked" as const }
                : x,
            ),
            {
              id: nextId,
              memberId: i.memberId,
              status: "pending" as const,
              expiresAt: this.now() + 7 * 86400000,
            },
          ],
        },
        result: nextId,
      };
    });
  }
  invitationState(id: string) {
    const i = this.state.doc.invitations.find((i) => i.id === id);
    if (!i) throw Error("Invitación no disponible.");
    return i.status === "pending" && i.expiresAt <= this.now()
      ? "expired"
      : i.status;
  }
  private manage(d: Doc, actor: string) {
    if (
      !d.members.some((m) => m.id === actor && m.active && m.role === "owner")
    )
      throw Error("Solo un propietario activo puede administrar esta muestra.");
  }
  private change(
    key: string,
    intent: unknown,
    fn: (d: Doc) => { doc: Doc; result: string },
  ) {
    if (!key || key.length > 160)
      return Promise.reject(Error("Identificador de operación no válido."));
    const signature = JSON.stringify(intent);
    let map = queues.get(this.storage);
    if (!map) {
      map = new Map();
      queues.set(this.storage, map);
    }
    const work = (map.get(this.key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!this.state.ready)
          throw Error("Recupera el equipo antes de guardar.");
        try {
          const raw = await this.storage.get(this.key),
            d = raw ? this.decode(raw) : this.state.doc;
          const receipt = d.receipts.find((r) => r.key === key);
          if (receipt) {
            if (receipt.signature !== signature)
              throw Error("Identificador de otra operación.");
            this.patch({ doc: d, error: "" });
            return receipt.result;
          }
          const result = fn(d),
            next = this.decode(
              JSON.stringify({
                ...result.doc,
                revision: d.revision + 1,
                receipts: [
                  ...d.receipts,
                  { key, signature, result: result.result },
                ].slice(-100),
              }),
            );
          await this.storage.set(this.key, JSON.stringify(next));
          this.patch({ doc: next, error: "" });
          return result.result;
        } catch (e) {
          this.patch({
            error:
              e instanceof Error
                ? e.message
                : "No se pudo guardar el equipo local.",
          });
          throw Error(this.state.error);
        }
      });
    map.set(this.key, work);
    return work;
  }
  invite(
    actor: string,
    input: { name: string; email: string; role: TeamRole },
    key: string,
  ) {
    const v = Object.freeze({ ...input });
    return this.change(key, ["invite", actor, v], (d) => {
      this.manage(d, actor);
      if (
        !v.name.trim() ||
        v.name.trim().length > 100 ||
        !/^[-a-z0-9._+]+@example\.test$/.test(v.email) ||
        !roles.includes(v.role)
      )
        throw Error("Usa nombre y correo ficticio @example.test.");
      if (d.members.some((m) => m.email === v.email))
        throw Error("Ese correo ya existe en la organización.");
      if (
        d.members.filter(
          (m) =>
            m.active ||
            d.invitations.some(
              (i) =>
                i.memberId === m.id &&
                i.status === "pending" &&
                i.expiresAt > this.now(),
            ),
        ).length >= 5
      )
        throw Error(
          "El plan ficticio admite cinco personas, incluidas invitaciones vigentes.",
        );
      if (d.invitations.length >= 100)
        throw Error("Límite local de invitaciones alcanzado.");
      const seq = d.sequence + 1,
        memberId = `demo-member-${seq}`,
        id = `demo-invite-${seq}`;
      return {
        doc: {
          ...d,
          sequence: seq,
          members: [
            ...d.members,
            {
              id: memberId,
              name: v.name.trim(),
              email: v.email,
              role: v.role,
              active: false,
              receiveNew: true,
              revision: 1,
            },
          ],
          invitations: [
            ...d.invitations,
            {
              id,
              memberId,
              status: "pending",
              expiresAt: this.now() + 7 * 86400000,
            },
          ],
        },
        result: id,
      };
    });
  }
  accept(id: string, key: string) {
    return this.change(key, ["accept", id], (d) => {
      const i = d.invitations.find((i) => i.id === id);
      if (!i || i.status !== "pending" || i.expiresAt <= this.now())
        throw Error("Invitación vencida, revocada o consumida.");
      if (d.members.filter((m) => m.active).length >= 5)
        throw Error("Sin cupo en el plan ficticio.");
      return {
        doc: {
          ...d,
          invitations: d.invitations.map((x) =>
            x.id === id ? { ...x, status: "accepted" } : x,
          ),
          members: d.members.map((m) =>
            m.id === i.memberId
              ? { ...m, active: true, revision: m.revision + 1 }
              : m,
          ),
        },
        result: i.memberId,
      };
    });
  }
  revoke(actor: string, id: string, key: string) {
    return this.change(key, ["revoke", actor, id], (d) => {
      this.manage(d, actor);
      const i = d.invitations.find((i) => i.id === id);
      if (!i || i.status !== "pending")
        throw Error("La invitación ya no está pendiente.");
      return {
        doc: {
          ...d,
          invitations: d.invitations.map((x) =>
            x.id === id ? { ...x, status: "revoked" } : x,
          ),
        },
        result: id,
      };
    });
  }
  update(
    actor: string,
    id: string,
    input: {
      role: TeamRole;
      active: boolean;
      receiveNew: boolean;
      expected: number;
    },
    key: string,
  ) {
    const v = Object.freeze({ ...input });
    return this.change(key, ["update", actor, id, v], (d) => {
      this.manage(d, actor);
      const m = d.members.find((m) => m.id === id);
      if (
        !m ||
        m.revision !== v.expected ||
        !roles.includes(v.role) ||
        typeof v.active !== "boolean" ||
        typeof v.receiveNew !== "boolean"
      )
        throw Error("La persona cambió o los campos no son válidos.");
      if (!m.active && v.active)
        throw Error(
          "Activar requiere una invitación aceptada; no se reactiva desde este control.",
        );
      if (
        m.active &&
        m.role === "owner" &&
        (!v.active || v.role !== "owner") &&
        d.members.filter((x) => x.active && x.role === "owner").length === 1
      )
        throw Error("No puedes quitar al último propietario.");
      return {
        doc: {
          ...d,
          members: d.members.map((x) =>
            x.id === id
              ? {
                  ...x,
                  role: v.role,
                  active: v.active,
                  receiveNew: v.receiveNew,
                  revision: m.revision + 1,
                }
              : x,
          ),
        },
        result: id,
      };
    });
  }
}
