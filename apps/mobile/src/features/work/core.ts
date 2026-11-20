import type { Actor, ConversationRepository } from "../inbox/model";
import type { StoragePort } from "../../services/storage";
import type { ChatTask, Event } from "../contact/model";
export type WorkTask = Readonly<{
  id: string;
  title: string;
  notes: string;
  due: number;
  assignee: string;
  done: boolean;
  contactId: string | null;
  revision: number;
}>;
export type NoteColor = "am" | "ve" | "az" | "bl";
export type WorkNote = Readonly<{
  id: string;
  title: string;
  body: string;
  color: NoteColor;
  pin: boolean;
  contactId: string | null;
  revision: number;
}>;
type WorkEvent = Event & Readonly<{ contactId: string; sequence: number }>;
type Doc = Readonly<{
  schema: 1;
  organizationId: string;
  userId: string;
  sequence: number;
  seeded: boolean;
  tasks: readonly WorkTask[];
  notes: readonly WorkNote[];
  events: readonly WorkEvent[];
  receipts: readonly { key: string; signature: string }[];
}>;
export type LegacyWork = Readonly<{
  contactId: string;
  sequence: number;
  tasks: readonly ChatTask[];
  events: readonly Event[];
}>;
export type WorkState = Readonly<{
  ready: boolean;
  saving: boolean;
  error: string;
  doc: Doc;
  visibility: number;
}>;
const people = ["demo-owner", "demo-coordinator", "demo-advisor"];
let operations = 0;
export const workKey = () =>
  `demo-work-op-${Date.now().toString(36)}-${++operations}`;
const freeze = (d: Doc): Doc =>
  Object.freeze({
    ...d,
    tasks: Object.freeze(
      d.tasks.map((t) => (Object.isFrozen(t) ? t : Object.freeze({ ...t }))),
    ),
    notes: Object.freeze(
      d.notes.map((n) => (Object.isFrozen(n) ? n : Object.freeze({ ...n }))),
    ),
    events: Object.freeze(
      d.events.map((e) => (Object.isFrozen(e) ? e : Object.freeze({ ...e }))),
    ),
    receipts: Object.freeze(d.receipts.map((r) => Object.freeze({ ...r }))),
  });
export class WorkRepository {
  readonly actor: Readonly<Actor>;
  readonly key: string;
  private state: WorkState;
  private listeners = new Set<() => void>();
  private restoration: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private jobs = new Map<
    string,
    { signature: string; promise: Promise<void> }
  >();
  private counters = new Map<string, number>();
  private visible = "";
  constructor(
    actor: Actor,
    readonly organizationId: string,
    readonly conversations: ConversationRepository,
    private storage: StoragePort,
    private legacy: () => Promise<readonly LegacyWork[]>,
    private now = Date.now,
  ) {
    if (
      !/^demo-org-[\w-]{1,60}$/.test(organizationId) ||
      !/^demo-[\w-]{1,80}$/.test(actor.id) ||
      !["owner", "coordinator", "advisor"].includes(actor.role)
    )
      throw Error("Scope ficticio inválido.");
    this.actor = conversations.team
      ? Object.freeze({
          id: actor.id,
          get role() {
            return conversations.team!.actor(actor.id).role;
          },
        })
      : Object.freeze({ ...actor });
    this.key = `dashfort.demo.work.v1.${organizationId}.${actor.id}`;
    this.state = Object.freeze({
      ready: false,
      saving: false,
      error: "",
      visibility: 0,
      doc: freeze({
        schema: 1,
        organizationId,
        userId: actor.id,
        sequence: 0,
        seeded: false,
        tasks: [],
        notes: [],
        events: [],
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
  private publish(p: Partial<WorkState>) {
    this.state = Object.freeze({ ...this.state, ...p });
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        /* Observers cannot abort storage. */
      }
    });
  }
  canRead(contactId: string | null) {
    if (!contactId) return true;
    try {
      this.conversations.get(this.actor, contactId);
      return true;
    } catch {
      return false;
    }
  }
  private contactAccess(id: string | null) {
    if (id) this.conversations.get(this.actor, id);
  }
  private taskAccess(t: WorkTask) {
    this.contactAccess(t.contactId);
    if (this.actor.role === "advisor" && t.assignee !== this.actor.id)
      throw Error("Tu perfil solo puede gestionar sus tareas propias.");
  }
  rememberSequence(id: string, sequence: number) {
    this.counters.set(id, Math.max(sequence, this.counters.get(id) ?? 0));
  }
  contact(id: string) {
    if (!this.state.ready || !this.canRead(id)) return null;
    const d = this.state.doc;
    return {
      tasks: d.tasks.filter(
        (t) =>
          t.contactId === id &&
          (this.actor.role !== "advisor" || t.assignee === this.actor.id),
      ),
      events: d.events.filter((e) => e.contactId === id),
      sequence: Math.max(
        this.counters.get(id) ?? 0,
        ...d.events.filter((e) => e.contactId === id).map((e) => e.sequence),
      ),
    };
  }
  tasks(all = false) {
    return this.state.doc.tasks.filter(
      (t) =>
        this.canRead(t.contactId) &&
        ((this.actor.role !== "advisor" && all) ||
          t.assignee === this.actor.id),
    );
  }
  notes() {
    return this.state.doc.notes.filter((n) => this.canRead(n.contactId));
  }
  getTask(id: string) {
    const t = this.state.doc.tasks.find((t) => t.id === id);
    if (!t) throw Error("Tarea no disponible.");
    this.taskAccess(t);
    return t;
  }
  getNote(id: string) {
    const n = this.state.doc.notes.find((n) => n.id === id);
    if (!n) throw Error("Nota no disponible.");
    this.contactAccess(n.contactId);
    return n;
  }
  reconcile = () => {
    const ids = [
      ...this.tasks(true).map(
        (t) =>
          `t:${t.id}:${t.contactId ? this.conversations.get(this.actor, t.contactId).name : ""}`,
      ),
      ...this.notes().map(
        (n) =>
          `n:${n.id}:${n.contactId ? this.conversations.get(this.actor, n.contactId).name : ""}`,
      ),
    ].join("|");
    if (ids !== this.visible) {
      this.visible = ids;
      this.publish({ visibility: this.state.visibility + 1 });
    }
  };
  private validate(d: Doc) {
    const str = (v: unknown, max: number) =>
      typeof v === "string" && v.length <= max;
    const link = (v: unknown) =>
      v === null ||
      (typeof v === "string" && /^demo-(conv|new)-[\w-]{1,100}$/.test(v));
    if (
      !d ||
      d.schema !== 1 ||
      d.organizationId !== this.organizationId ||
      d.userId !== this.actor.id ||
      !Number.isSafeInteger(d.sequence) ||
      d.sequence < 0 ||
      typeof d.seeded !== "boolean" ||
      !Array.isArray(d.tasks) ||
      d.tasks.length > 5000 ||
      !Array.isArray(d.notes) ||
      d.notes.length > 1000 ||
      !Array.isArray(d.events) ||
      d.events.length > 2000 ||
      !Array.isArray(d.receipts) ||
      d.receipts.length > 500
    )
      throw Error(
        "Los datos de trabajo locales no son válidos; no se sobrescribieron.",
      );
    for (const t of d.tasks)
      if (
        !t ||
        !str(t.id, 160) ||
        !t.id ||
        !str(t.title, 300) ||
        !t.title.trim() ||
        !str(t.notes, 4000) ||
        !Number.isFinite(t.due) ||
        !Number.isFinite(new Date(t.due).getTime()) ||
        new Date(t.due).getFullYear() < 2000 ||
        new Date(t.due).getFullYear() > 2100 ||
        !(this.conversations.team
          ? this.conversations.team.known(t.assignee)
          : people.includes(t.assignee)) ||
        typeof t.done !== "boolean" ||
        !link(t.contactId) ||
        !Number.isSafeInteger(t.revision) ||
        t.revision < 1
      )
        throw Error("La tarea local no es válida.");
    for (const n of d.notes)
      if (
        !n ||
        !str(n.id, 160) ||
        !n.id ||
        !str(n.title, 300) ||
        !str(n.body, 4000) ||
        !n.body.trim() ||
        !["am", "ve", "az", "bl"].includes(n.color) ||
        typeof n.pin !== "boolean" ||
        !link(n.contactId) ||
        !Number.isSafeInteger(n.revision) ||
        n.revision < 1
      )
        throw Error("La nota local no es válida.");
    for (const e of d.events)
      if (
        !e ||
        !str(e.id, 160) ||
        !link(e.contactId) ||
        !e.contactId ||
        !["Tarea", "Nota"].includes(e.kind) ||
        !str(e.text, 4000) ||
        !Number.isFinite(e.at) ||
        !Number.isSafeInteger(e.sequence) ||
        e.sequence < 1
      )
        throw Error("El historial de trabajo no es válido.");
    for (const r of d.receipts)
      if (!r || !str(r.key, 160) || !r.key || !str(r.signature, 12000))
        throw Error("El comprobante local no es válido.");
    for (const row of [...d.tasks, ...d.notes]) {
      const seq = /^demo-work-(?:task|note)-local-(\d+)$/.exec(row.id);
      if (seq && Number(seq[1]) > d.sequence)
        throw Error("Secuencia local inconsistente.");
    }
    for (const rows of [d.tasks, d.notes, d.events])
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        throw Error("El trabajo local contiene identificadores duplicados.");
    if (new Set(d.receipts.map((r) => r.key)).size !== d.receipts.length)
      throw Error("Hay operaciones locales duplicadas.");
  }
  hydrate = (): Promise<void> => {
    if (this.restoration) return this.restoration;
    if (this.state.ready) return Promise.resolve();
    this.restoration = Promise.resolve().then(async () => {
      try {
        const raw = await this.storage.get(this.key);
        let d = this.state.doc;
        if (raw !== null) {
          if (raw.length > 8_000_000)
            throw Error("El trabajo local supera el límite de lectura.");
          d = JSON.parse(raw);
          this.validate(d);
        } else {
          const previous = await this.legacy();
          const tasks: WorkTask[] = [],
            notes: WorkNote[] = [];
          for (const c of previous) {
            this.rememberSequence(c.contactId, c.sequence);
            for (const t of c.tasks)
              tasks.push({
                ...t,
                contactId: c.contactId,
                notes: t.notes ?? "",
                revision: t.revision ?? 1,
              });
            for (const e of c.events)
              if (e.kind === "Nota")
                notes.push({
                  id: e.id,
                  contactId: c.contactId,
                  title: "",
                  body: e.text,
                  color: "bl",
                  pin: false,
                  revision: 1,
                });
          }
          d = { ...d, tasks, notes };
          this.validate(d);
        }
        this.publish({ doc: freeze(d), ready: true, error: "" });
        this.reconcile();
      } catch (e) {
        this.publish({
          ready: false,
          error:
            e instanceof Error
              ? e.message
              : "No se pudo leer el trabajo local.",
        });
      } finally {
        this.restoration = null;
      }
    });
    return this.restoration;
  };
  fixtures() {
    if (!this.state.ready || this.state.saving || this.state.doc.seeded) return;
    const d = this.state.doc,
      now = this.now();
    const pick = (id: string) => (this.canRead(id) ? id : null);
    const tasks: WorkTask[] = [
      {
        id: "demo-work-task-1",
        title: "Mandar cotización a Karla Méndez",
        contactId: pick("demo-conv-1"),
        assignee: this.actor.id,
        due: now + 3600000,
        notes: "",
        done: false,
        revision: 1,
      },
      {
        id: "demo-work-task-2",
        title: "Llamar a Pastelería Dulce Vida",
        contactId: null,
        assignee: "demo-coordinator",
        due: now - 86400000,
        notes: "",
        done: false,
        revision: 1,
      },
      {
        id: "demo-work-task-3",
        title: "Subir catálogo de mayoreo a la Biblioteca",
        contactId: null,
        assignee: this.actor.id,
        due: now + 86400000,
        notes: "",
        done: false,
        revision: 1,
      },
      {
        id: "demo-work-task-4",
        title: "Confirmar cita de Unid Campus",
        contactId: pick("demo-conv-7"),
        assignee: "demo-advisor",
        due: now - 3 * 86400000,
        notes: "",
        done: true,
        revision: 1,
      },
    ];
    const notes: WorkNote[] = [
      {
        id: "demo-work-note-1",
        title: "Precios mayoreo",
        body: "10+ piezas: 15 %\n50+ piezas: 22 %",
        color: "am",
        pin: true,
        contactId: null,
        revision: 1,
      },
      {
        id: "demo-work-note-2",
        title: "",
        body: "Pedir a Cristal el RFC para la factura.",
        color: "bl",
        pin: false,
        contactId: pick("demo-conv-3"),
        revision: 1,
      },
      {
        id: "demo-work-note-3",
        title: "Ideas de campaña",
        body: "Recordatorio de citas por la mañana; 2×1 los jueves.",
        color: "az",
        pin: false,
        contactId: null,
        revision: 1,
      },
      {
        id: "demo-work-note-4",
        title: "Horarios",
        body: "L–V 9:00 a 19:00\nSáb 10:00 a 14:00",
        color: "ve",
        pin: false,
        contactId: null,
        revision: 1,
      },
    ];
    this.publish({
      doc: freeze({
        ...d,
        seeded: true,
        tasks: [
          ...d.tasks,
          ...tasks.filter((t) => !d.tasks.some((x) => x.id === t.id)),
        ],
        notes: [
          ...d.notes,
          ...notes.filter((n) => !d.notes.some((x) => x.id === n.id)),
        ],
      }),
    });
  }
  private event(
    d: Doc,
    id: string | null,
    kind: "Tarea" | "Nota",
    text: string,
  ): Doc {
    if (!id) return d;
    const sequence =
      Math.max(
        this.counters.get(id) ?? 0,
        ...d.events.filter((e) => e.contactId === id).map((e) => e.sequence),
      ) + 1;
    const counts = new Map<string, number>();
    return {
      ...d,
      events: [
        {
          id: `${id}:work-event:${d.sequence}`,
          contactId: id,
          kind,
          text,
          at: this.now(),
          sequence,
        },
        ...d.events,
      ]
        .filter((e) => {
          const count = (counts.get(e.contactId) ?? 0) + 1;
          counts.set(e.contactId, count);
          return count <= 250;
        })
        .slice(0, 2000),
    };
  }
  private change(
    key: string,
    signature: unknown,
    contacts: readonly (string | null)[] | (() => readonly (string | null)[]),
    fn: (d: Doc) => Doc,
  ): Promise<void> {
    if (!key || key.length > 160)
      throw Error("Identificador de operación no válido.");
    const sig = JSON.stringify(signature),
      job = this.jobs.get(key);
    if (job) {
      if (job.signature !== sig)
        throw Error("Ese identificador pertenece a otro cambio.");
      return job.promise;
    }
    const promise = this.queue
      .catch(() => {})
      .then(async () => {
        if (!this.state.ready)
          throw Error("Espera a que se cargue el trabajo local.");
        const old = this.state.doc,
          receipt = old.receipts.find((r) => r.key === key);
        if (receipt) {
          if (receipt.signature !== sig)
            throw Error("Ese identificador pertenece a otro cambio.");
          return;
        }
        const scope = typeof contacts === "function" ? contacts() : contacts;
        scope.forEach((id) => this.contactAccess(id));
        let next = fn({ ...old, sequence: old.sequence + 1 });
        next = freeze({
          ...next,
          receipts: [...next.receipts, { key, signature: sig }].slice(-500),
        });
        this.validate(next);
        const raw = JSON.stringify(next);
        if (raw.length > 8_000_000)
          throw Error("El trabajo local alcanzó su límite de demostración.");
        this.publish({ saving: true, error: "" });
        try {
          await this.storage.set(this.key, raw);
          try {
            scope.forEach((id) => this.contactAccess(id));
          } catch (e) {
            try {
              await this.storage.set(this.key, JSON.stringify(old));
            } catch {
              this.publish({
                ready: false,
                error:
                  "El alcance cambió y la reversión local es incierta. Recarga antes de continuar.",
              });
            }
            throw e;
          }
          this.publish({ doc: next });
          this.reconcile();
        } catch (e) {
          this.publish({
            error:
              e instanceof Error
                ? e.message
                : "No se pudo guardar el trabajo local.",
          });
          throw e;
        } finally {
          this.publish({ saving: false });
        }
      })
      .catch((e) => {
        this.jobs.delete(key);
        throw e;
      });
    this.jobs.set(key, { signature: sig, promise });
    if (this.jobs.size > 500) this.jobs.delete(this.jobs.keys().next().value!);
    this.queue = promise;
    return promise;
  }
  saveTask(
    input: Omit<WorkTask, "id" | "revision" | "done"> & {
      id?: string;
      revision?: number;
      done?: boolean;
    },
    key = workKey(),
  ) {
    input = Object.freeze({ ...input });
    return this.change(
      key,
      ["task", input],
      () => [
        input.contactId,
        input.id ? this.getTask(input.id).contactId : null,
      ],
      (d) => {
        if (!input.title.trim() || input.title.trim().length > 300)
          throw Error("Escribe una tarea de hasta 300 caracteres.");
        if (
          !Number.isFinite(input.due) ||
          !Number.isFinite(new Date(input.due).getTime()) ||
          new Date(input.due).getFullYear() < 2000 ||
          new Date(input.due).getFullYear() > 2100
        )
          throw Error("Elige una fecha límite válida.");
        if (
          !(this.conversations.team
            ? this.conversations.team.available(input.assignee)
            : people.includes(input.assignee))
        )
          throw Error("Elige una persona activa del equipo.");
        const old = input.id ? this.getTask(input.id) : null;
        if (old && old.revision !== input.revision)
          throw Error("La tarea cambió. Vuelve a abrirla.");
        if (this.actor.role === "advisor" && input.assignee !== this.actor.id)
          throw Error("Tu perfil solo puede crearse tareas propias.");
        if (
          old?.contactId !== input.contactId &&
          input.contactId &&
          d.tasks.filter((t) => t.contactId === input.contactId).length >= 100
        )
          throw Error(
            "Se alcanzó el límite de 100 tareas de este chat de prueba.",
          );
        const task: WorkTask = {
          id: old?.id ?? `demo-work-task-local-${d.sequence}`,
          title: input.title.trim(),
          notes: input.notes,
          due: input.due,
          assignee: input.assignee,
          contactId: input.contactId,
          done: input.done ?? old?.done ?? false,
          revision: (old?.revision ?? 0) + 1,
        };
        this.taskAccess(task);
        let next: Doc = {
          ...d,
          tasks: old
            ? d.tasks.map((t) => (t.id === old.id ? task : t))
            : [...d.tasks, task],
        };
        if (old?.contactId && old.contactId !== task.contactId)
          next = this.event(
            next,
            old.contactId,
            "Tarea",
            `Tarea trasladada: ${task.title}`,
          );
        return this.event(
          next,
          task.contactId,
          "Tarea",
          old
            ? `Tarea actualizada: ${task.title}`
            : `Tarea creada: ${task.title}`,
        );
      },
    );
  }
  toggleTask(id: string, key = workKey()) {
    return this.change(
      key,
      ["toggle", id],
      () => [this.getTask(id).contactId],
      (d) => {
        const current = this.getTask(id);
        const next = {
          ...d,
          tasks: d.tasks.map((t) =>
            t.id === id
              ? { ...t, done: !current.done, revision: t.revision + 1 }
              : t,
          ),
        };
        return this.event(
          next,
          current.contactId,
          "Tarea",
          `${current.done ? "Tarea reabierta" : "Tarea completada"}: ${current.title}`,
        );
      },
    );
  }
  removeTask(id: string, revision: number, key = workKey()) {
    return this.change(
      key,
      ["delete-task", id, revision],
      () => [this.getTask(id).contactId],
      (d) => {
        const current = this.getTask(id);
        if (current.revision !== revision)
          throw Error("La tarea cambió. Vuelve a abrirla.");
        return this.event(
          { ...d, tasks: d.tasks.filter((t) => t.id !== id) },
          current.contactId,
          "Tarea",
          `Tarea borrada: ${current.title}`,
        );
      },
    );
  }
  saveNote(
    input: Omit<WorkNote, "id" | "revision"> & {
      id?: string;
      revision?: number;
    },
    key = workKey(),
  ) {
    input = Object.freeze({ ...input });
    return this.change(
      key,
      ["note", input],
      () => [
        input.contactId,
        input.id ? this.getNote(input.id).contactId : null,
      ],
      (d) => {
        const old = input.id ? this.getNote(input.id) : null;
        if (old && old.revision !== input.revision)
          throw Error("La nota cambió. Vuelve a abrirla.");
        const n: WorkNote = {
          id: old?.id ?? `demo-work-note-local-${d.sequence}`,
          title: input.title.trim(),
          body: input.body.trim(),
          color: input.color,
          pin: input.pin,
          contactId: input.contactId,
          revision: (old?.revision ?? 0) + 1,
        };
        let next: Doc = {
          ...d,
          notes: old
            ? d.notes.map((x) => (x.id === old.id ? n : x))
            : [...d.notes, n],
        };
        if (old?.contactId && old.contactId !== n.contactId)
          next = this.event(
            next,
            old.contactId,
            "Nota",
            "Nota trasladada a otro contacto",
          );
        return this.event(next, n.contactId, "Nota", n.body);
      },
    );
  }
  removeNote(id: string, revision: number, key = workKey()) {
    return this.change(
      key,
      ["delete-note", id, revision],
      () => [this.getNote(id).contactId],
      (d) => {
        const current = this.getNote(id);
        if (current.revision !== revision)
          throw Error("La nota cambió. Vuelve a abrirla.");
        return this.event(
          { ...d, notes: d.notes.filter((n) => n.id !== id) },
          current.contactId,
          "Nota",
          "Nota borrada del espacio de trabajo",
        );
      },
    );
  }
}
