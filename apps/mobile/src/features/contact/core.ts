import {
  stages,
  tags as tagCatalog,
  type Actor,
  type Conversation,
  type ConversationRepository,
} from "../inbox/model";
import type { LocalStoragePort } from "../chat/core";
import {
  canAssign,
  defaultFlags,
  eventKinds,
  lossReasons,
  modeProblem,
  priorities,
  seedDetails,
  team,
  type ContactData,
  type DemoFlags,
  type EventKind,
  type Mode,
} from "./model";
export type ViewState = "normal" | "loading" | "empty" | "error" | "offline";
export type ContactSnapshot = Readonly<{
  data: ContactData;
  ready: boolean;
  saving: boolean;
  error: string;
  view: ViewState;
  noteDraft: string;
  filter: string;
}>;
export const systemImportTag = "Importación · demo";
const allTags = [...tagCatalog, systemImportTag];
const isPerson = (v: unknown) => v === null || team.some((p) => p.id === v);
export function decodeDetails(raw: string): ContactData {
  const d = JSON.parse(raw) as ContactData;
  const text = (v: unknown, max: number) =>
    typeof v === "string" && v.length <= max;
  if (
    !d ||
    d.version !== 1 ||
    !stages.includes(d.stage as (typeof stages)[number]) ||
    !isPerson(d.assigned) ||
    !["on", "pause", "off"].includes(d.ai) ||
    !["meta", "direct", "hybrid"].includes(d.mode) ||
    !Array.isArray(d.tags) ||
    d.tags.length > 30 ||
    new Set(d.tags).size !== d.tags.length ||
    !d.tags.every((t) => allTags.includes(t)) ||
    !priorities.includes(d.priority as (typeof priorities)[number]) ||
    !(
      d.amountCents === null ||
      (Number.isSafeInteger(d.amountCents) &&
        d.amountCents >= 0 &&
        d.amountCents <= 9_999_999_999)
    ) ||
    !text(d.lossReason, 100) ||
    (d.lossReason !== "" &&
      !(lossReasons as readonly string[]).includes(d.lossReason)) ||
    !text(d.lossDetail, 2000) ||
    (d.stage === "Perdido" && !d.lossReason) ||
    !Number.isSafeInteger(d.sequence) ||
    d.sequence < 0 ||
    !Array.isArray(d.events) ||
    d.events.length > 250 ||
    !Array.isArray(d.tasks) ||
    d.tasks.length > 100
  )
    throw new Error(
      "Los detalles locales no son válidos. No se sobrescribieron.",
    );
  for (const e of d.events)
    if (
      !e ||
      !text(e.id, 160) ||
      !eventKinds.includes(e.kind) ||
      !text(e.text, 4000) ||
      !Number.isFinite(e.at)
    )
      throw new Error("El historial local no es válido.");
  for (const t of d.tasks)
    if (
      !t ||
      !text(t.id, 160) ||
      !text(t.title, 300) ||
      !t.title.trim() ||
      !Number.isFinite(t.due) ||
      t.assignee === null ||
      !isPerson(t.assignee) ||
      typeof t.done !== "boolean"
    )
      throw new Error("Las tareas locales no son válidas.");
  if (
    new Set(d.events.map((e) => e.id)).size !== d.events.length ||
    new Set(d.tasks.map((t) => t.id)).size !== d.tasks.length
  )
    throw new Error("El historial contiene identificadores duplicados.");
  return d;
}
let requestCounter = 0;
export const actionKey = () =>
  `demo-action-${Date.now().toString(36)}-${++requestCounter}`;
export class ContactDirectory {
  private stores = new Map<string, ContactStore>();
  private listeners = new Set<() => void>();
  private settings: DemoFlags;
  activeWrites = 0;
  constructor(
    readonly actor: Actor,
    readonly conversations: ConversationRepository,
    readonly storage: LocalStoragePort,
    readonly changed: () => void,
    readonly now: () => number = Date.now,
  ) {
    this.settings = defaultFlags(actor);
  }
  flags = () => this.settings;
  subscribeFlags = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  setFlags = (patch: Partial<DemoFlags>) => {
    if (this.activeWrites) throw new Error("Espera a que termine el cambio.");
    this.settings = { ...this.settings, ...patch };
    this.listeners.forEach((fn) => fn());
  };
  reconcile = () => {
    this.stores.forEach((store) => store.reconcile());
  };
  get = (id: string) => {
    this.conversations.get(this.actor, id);
    let s = this.stores.get(id);
    if (s) {
      this.stores.delete(id);
      this.stores.set(id, s);
    }
    if (!s) {
      if (this.stores.size >= 64) {
        const candidate = [...this.stores].find(
          ([, v]) =>
            v.snapshot().ready &&
            !v.snapshot().saving &&
            !v.snapshot().noteDraft,
        );
        if (!candidate)
          throw new Error("Guarda tus borradores antes de abrir más detalles.");
        this.stores.delete(candidate[0]);
      }
      s = new ContactStore(this, id);
      this.stores.set(id, s);
    }
    return s;
  };
}
export class ContactStore {
  readonly storageKey: string;
  private state: ContactSnapshot;
  private listeners = new Set<() => void>();
  private hydration: Promise<void> | null = null;
  private work: Promise<unknown> = Promise.resolve();
  private requests = new Map<
    string,
    { signature: string; work: Promise<void> }
  >();
  failNext = false;
  detailsOffset = 0;
  timelineOffset = 0;
  constructor(
    readonly directory: ContactDirectory,
    readonly id: string,
  ) {
    const c = this.authorize();
    let data = seedDetails(c, directory.now());
    if (c.id === "demo-conv-3")
      data = { ...data, tags: [...c.tags, systemImportTag] };
    this.state = {
      data,
      ready: false,
      saving: false,
      error: "",
      view: "normal",
      noteDraft: "",
      filter: "Todo",
    };
    this.storageKey = `dashfort.demo.contact.v1.${directory.actor.id}.${id}`;
  }
  get actor() {
    return this.directory.actor;
  }
  authorize = () => this.directory.conversations.get(this.actor, this.id);
  snapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private patch(p: Partial<ContactSnapshot>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((fn) => fn());
  }
  private basePatch(data: ContactData) {
    const c = this.authorize();
    const p: {
      -readonly [K in "stage" | "tags" | "ai" | "assigned"]?: Conversation[K];
    } = {};
    if (c.stage !== data.stage) p.stage = data.stage;
    if (c.assigned !== data.assigned) p.assigned = data.assigned;
    if (c.ai !== data.ai) p.ai = data.ai;
    if (JSON.stringify(c.tags) !== JSON.stringify(data.tags))
      p.tags = data.tags;
    if (Object.keys(p).length) {
      this.directory.conversations.updateContact(this.actor, this.id, p);
      this.directory.changed();
    }
  }
  reconcile = () => {
    if (!this.state.ready || this.state.saving) return;
    let c: Conversation;
    try {
      c = this.authorize();
    } catch {
      return;
    }
    const d = this.state.data;
    if (
      d.stage === c.stage &&
      d.assigned === c.assigned &&
      d.ai === c.ai &&
      JSON.stringify(d.tags) === JSON.stringify(c.tags)
    )
      return;
    this.patch({
      data: {
        ...d,
        stage: c.stage,
        assigned: c.assigned,
        ai: c.ai,
        tags: c.tags,
        lossReason:
          c.stage === "Perdido" ? d.lossReason || "Sin respuesta" : "",
        lossDetail: c.stage === "Perdido" ? d.lossDetail : "",
      },
    });
  };
  hydrate = () => {
    if (this.state.ready) return Promise.resolve();
    if (this.hydration) return this.hydration;
    this.hydration = (async () => {
      try {
        const before = this.authorize();
        const raw = await this.directory.storage.get(this.storageKey);
        let data = raw ? decodeDetails(raw) : this.state.data;
        const current = this.authorize();
        if (current.stage !== before.stage)
          data = {
            ...data,
            stage: current.stage,
            lossReason:
              current.stage === "Perdido"
                ? data.lossReason || "Sin respuesta"
                : "",
            lossDetail: current.stage === "Perdido" ? data.lossDetail : "",
          };
        if (current.assigned !== before.assigned)
          data = { ...data, assigned: current.assigned };
        if (JSON.stringify(current.tags) !== JSON.stringify(before.tags))
          data = { ...data, tags: current.tags };
        if (current.ai !== before.ai) data = { ...data, ai: current.ai };
        if (this.actor.role === "advisor" && data.assigned !== this.actor.id)
          throw new Error("Los detalles no pertenecen a tu alcance.");
        this.basePatch(data);
        this.patch({ data, ready: true, error: "" });
      } catch (e) {
        this.patch({
          ready: false,
          error:
            e instanceof Error
              ? e.message
              : "No se pudieron cargar los detalles.",
        });
      } finally {
        this.hydration = null;
      }
    })();
    return this.hydration;
  };
  view = (view: ViewState) => this.patch({ view, error: "" });
  setFilter = (filter: string) => {
    this.timelineOffset = 0;
    this.patch({ filter });
  };
  setNoteDraft = (noteDraft: string) => {
    this.authorize();
    if (noteDraft.length > 4000)
      throw new Error("La nota admite hasta 4.000 caracteres.");
    this.patch({ noteDraft });
  };
  private mutate(
    key: string,
    signature: unknown,
    change: (
      d: ContactData,
    ) => { data: ContactData; kind: EventKind; text: string } | null,
  ): Promise<void> {
    this.authorize();
    if (!key || key.length > 160)
      throw new Error("Identificador de operación no válido.");
    const sig = JSON.stringify(signature),
      previous = this.requests.get(key);
    if (previous) {
      if (previous.signature !== sig)
        throw new Error("Ese identificador pertenece a otro cambio.");
      return previous.work;
    }
    if (this.requests.size >= 500)
      throw new Error("Se alcanzó el límite de operaciones de esta demo.");
    const work = this.work
      .catch(() => {})
      .then(async () => {
        if (!this.state.ready)
          throw new Error("Espera a que se carguen los detalles.");
        if (this.state.view !== "normal" && this.state.view !== "empty")
          throw new Error(
            this.state.view === "offline"
              ? "Sin conexión. Conservamos los datos y el borrador; reintenta al reconectar."
              : "Recupera los detalles antes de guardar.",
          );
        const c = this.authorize();
        const old = this.state.data;
        const current = {
          ...old,
          stage: c.stage,
          assigned: c.assigned,
          tags: c.tags,
          ai: c.ai,
        };
        const result = change(current);
        if (!result) return;
        this.directory.activeWrites++;
        this.patch({ saving: true, error: "" });
        try {
          if (this.failNext) {
            this.failNext = false;
            throw new Error(
              "No se pudo guardar el cambio simulado. Reintenta.",
            );
          }
          const n = current.sequence + 1;
          const data: ContactData = {
            ...result.data,
            sequence: n,
            events: [
              {
                id: `${this.id}:event:${n}`,
                kind: result.kind,
                text: result.text,
                at: this.directory.now(),
              },
              ...current.events,
            ].slice(0, 250),
          };
          decodeDetails(JSON.stringify(data));
          await this.directory.storage.set(
            this.storageKey,
            JSON.stringify(data),
          );
          if (this.authorize() !== c) {
            await this.directory.storage.set(
              this.storageKey,
              JSON.stringify(old),
            );
            throw new Error(
              "El chat cambió mientras guardabas. Reintenta con sus datos actuales.",
            );
          }
          this.basePatch(data);
          this.patch({ data, view: "normal", error: "" });
        } finally {
          this.directory.activeWrites--;
          this.patch({ saving: false });
          this.reconcile();
        }
      })
      .catch((e) => {
        this.requests.delete(key);
        throw e;
      });
    this.requests.set(key, { signature: sig, work });
    this.work = work;
    return work;
  }
  stage = (stage: string, reason = "", detail = "", key = actionKey()) =>
    this.mutate(key, ["stage", stage, reason, detail], (d) => {
      if (!(stages as readonly string[]).includes(stage))
        throw new Error("Elige una etapa válida.");
      if (
        stage === "Perdido" &&
        !(lossReasons as readonly string[]).includes(reason)
      )
        throw new Error("Elige un motivo de pérdida.");
      if (detail.length > 2000)
        throw new Error("El detalle admite hasta 2.000 caracteres.");
      if (
        d.stage === stage &&
        (stage !== "Perdido" ||
          (d.lossReason === reason && d.lossDetail === detail.trim()))
      )
        return null;
      return {
        data: {
          ...d,
          stage,
          lossReason: stage === "Perdido" ? reason : "",
          lossDetail: stage === "Perdido" ? detail.trim() : "",
        },
        kind: "Etapa",
        text: `${d.stage} → ${stage}${stage === "Perdido" ? ` · ${reason}${detail.trim() ? ` · ${detail.trim()}` : ""}` : ""}`,
      };
    });
  assign = (assigned: string | null, key = actionKey()) =>
    this.mutate(key, ["assign", assigned], (d) => {
      if (!canAssign(this.actor))
        throw new Error("Tu perfil no puede asignar conversaciones.");
      if (!isPerson(assigned))
        throw new Error("Elige una persona activa del equipo.");
      if (d.assigned === assigned) return null;
      const name = team.find((p) => p.id === assigned)?.name ?? "Sin asignar";
      return {
        data: { ...d, assigned },
        kind: "Asignación",
        text: `Asignado a ${name}`,
      };
    });
  tags = (selected: readonly string[], key = actionKey()) =>
    this.mutate(key, ["tags", selected], (d) => {
      if (
        selected.length > 30 ||
        new Set(selected).size !== selected.length ||
        selected.some((t) => !allTags.includes(t))
      )
        throw new Error("Selecciona etiquetas válidas.");
      if (
        d.tags.includes(systemImportTag) &&
        !selected.includes(systemImportTag)
      )
        throw new Error(
          "Las etiquetas de importación son de sistema y no se pueden quitar.",
        );
      if (
        JSON.stringify([...d.tags].sort()) ===
        JSON.stringify([...selected].sort())
      )
        return null;
      return {
        data: { ...d, tags: [...selected] },
        kind: "Etiquetas",
        text: `Etiquetas: ${selected.join(", ") || "Sin etiquetas"}`,
      };
    });
  ai = (ai: Conversation["ai"], key = actionKey()) =>
    this.mutate(key, ["ai", ai], (d) => {
      if (!["on", "pause", "off"].includes(ai))
        throw new Error("Estado de IA no válido.");
      if (d.ai === ai) return null;
      return {
        data: { ...d, ai },
        kind: "IA",
        text:
          ai === "on"
            ? "La IA atiende"
            : ai === "pause"
              ? "IA en pausa"
              : "IA apagada",
      };
    });
  take = (key = actionKey()) =>
    this.mutate(key, ["take"], (d) => ({
      data: { ...d, ai: "pause", assigned: this.actor.id },
      kind: "Asignación",
      text: `${team.find((p) => p.id === this.actor.id)?.name ?? "Tú"} tomó este chat; IA en pausa`,
    }));
  mode = (mode: Mode, key = actionKey()) =>
    this.mutate(key, ["mode", mode], (d) => {
      const error = modeProblem(
        this.actor,
        this.authorize(),
        this.directory.flags(),
        mode,
      );
      if (error) throw new Error(error);
      if (d.mode === mode) return null;
      return {
        data: { ...d, mode },
        kind: "Conexión",
        text:
          mode === "meta"
            ? "Conexión: Meta"
            : mode === "direct"
              ? "Conexión directa"
              : "Conexión híbrida",
      };
    });
  sale = (amountCents: number | null, priority: string, key = actionKey()) =>
    this.mutate(key, ["sale", amountCents, priority], (d) => {
      if (this.authorize().group)
        throw new Error("Este grupo no tiene una venta asociada.");
      if (
        !(priorities as readonly string[]).includes(priority) ||
        (amountCents !== null &&
          (!Number.isSafeInteger(amountCents) ||
            amountCents < 0 ||
            amountCents > 9_999_999_999))
      )
        throw new Error("Monto o prioridad no válido.");
      if (d.amountCents === amountCents && d.priority === priority) return null;
      return {
        data: { ...d, amountCents, priority },
        kind: "Venta",
        text: `Venta actualizada · Prioridad ${priority}`,
      };
    });
  note = (text: string, key = actionKey()) => {
    const draft = this.state.noteDraft;
    return this.mutate(key, ["note", text], (d) => {
      if (!text.trim() || text.length > 4000)
        throw new Error("Escribe una nota de hasta 4.000 caracteres.");
      return { data: d, kind: "Nota", text: text.trim() };
    }).then(() => {
      if (this.state.noteDraft === draft) this.patch({ noteDraft: "" });
    });
  };
  task = (title: string, due: number, assignee: string, key = actionKey()) =>
    this.mutate(key, ["task", title, due, assignee], (d) => {
      if (!title.trim() || title.trim().length > 300)
        throw new Error("Escribe una tarea de hasta 300 caracteres.");
      if (
        !Number.isFinite(due) ||
        new Date(due).getFullYear() < 2000 ||
        new Date(due).getFullYear() > 2100
      )
        throw new Error("Elige una fecha límite válida.");
      if (!assignee || !isPerson(assignee))
        throw new Error("Elige una persona activa del equipo.");
      if (this.actor.role === "advisor" && assignee !== this.actor.id)
        throw new Error("Tu perfil solo puede crearse tareas propias.");
      if (d.tasks.length >= 100)
        throw new Error(
          "Se alcanzó el límite de 100 tareas de este chat de prueba.",
        );
      return {
        data: {
          ...d,
          tasks: [
            ...d.tasks,
            {
              id: `${this.id}:task:${d.sequence + 1}`,
              title: title.trim(),
              due,
              assignee,
              done: false,
            },
          ],
        },
        kind: "Tarea",
        text: `Tarea creada: ${title.trim()}`,
      };
    });
  toggleTask = (id: string, key = actionKey()) =>
    this.mutate(key, ["toggleTask", id], (d) => {
      const task = d.tasks.find((t) => t.id === id);
      if (!task) throw new Error("Tarea no disponible.");
      if (this.actor.role === "advisor" && task.assignee !== this.actor.id)
        throw new Error("Tu perfil solo puede completar sus tareas.");
      return {
        data: {
          ...d,
          tasks: d.tasks.map((t) =>
            t.id === id ? { ...t, done: !t.done } : t,
          ),
        },
        kind: "Tarea",
        text: `${task.done ? "Tarea reabierta" : "Tarea completada"}: ${task.title}`,
      };
    });
}
