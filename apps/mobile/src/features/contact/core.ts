import type { TeamRepository } from "../team/core";
import { importTag, type CatalogStore } from "../catalog/core";
import {
  stages,
  tags as tagCatalog,
  type Actor,
  type Conversation,
  type ConversationRepository,
} from "../inbox/model";
import type { LocalStoragePort } from "../chat/core";
import { WorkRepository, type LegacyWork } from "../work/core";
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
export const systemImportTag = importTag;
const allTags = [...tagCatalog, systemImportTag];
const isPerson = (v: unknown) => v === null || team.some((p) => p.id === v);
export function decodeDetails(
  raw: string,
  catalog: readonly string[] = stages,
  business?: CatalogStore,
  roster?: TeamRepository,
): ContactData {
  const d = JSON.parse(raw) as ContactData;
  const isPerson = (v: unknown) =>
    v === null ||
    (typeof v === "string" &&
      (roster ? roster.known(v) : team.some((p) => p.id === v)));
  const text = (v: unknown, max: number) =>
    typeof v === "string" && v.length <= max;
  if (
    !d ||
    d.version !== 1 ||
    !catalog.includes(d.stage) ||
    !isPerson(d.assigned) ||
    !["on", "pause", "off"].includes(d.ai) ||
    !["meta", "direct", "hybrid"].includes(d.mode) ||
    (d.modeEpoch !== undefined &&
      (!Number.isSafeInteger(d.modeEpoch) || d.modeEpoch < 0)) ||
    !Array.isArray(d.tags) ||
    d.tags.length > 30 ||
    new Set(d.tags).size !== d.tags.length ||
    !d.tags.every((t) =>
      business ? business.knownTag(t) : allTags.includes(t),
    ) ||
    !priorities.includes(d.priority as (typeof priorities)[number]) ||
    !(
      d.amountCents === null ||
      (Number.isSafeInteger(d.amountCents) &&
        d.amountCents >= 0 &&
        d.amountCents <= 9_999_999_999)
    ) ||
    !text(d.lossReason, 100) ||
    (d.lossReason !== "" &&
      !(business
        ? business.knownReason(d.lossReason)
        : (lossReasons as readonly string[]).includes(d.lossReason))) ||
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
  readonly workRepo: WorkRepository;
  readonly organizationId: string;
  contactPrefix() {
    return this.organizationId === "demo-org-cristal"
      ? `dashfort.demo.contact.v1.${this.actor.id}.`
      : `dashfort.demo.contact.v2.${this.organizationId}.${this.actor.id}.`;
  }
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
    this.organizationId =
      conversations.catalog?.organizationId ?? "demo-org-cristal";
    this.settings = defaultFlags(actor);
    this.workRepo = new WorkRepository(
      actor,
      this.organizationId,
      conversations,
      storage,
      () => this.readLegacyWork(),
      now,
    );
    this.workRepo.subscribe(() => this.stores.forEach((s) => s.syncWork()));
  }
  private async readLegacyWork(): Promise<readonly LegacyWork[]> {
    await this.conversations.catalog?.hydrate();
    if (
      this.conversations.catalog &&
      !this.conversations.catalog.snapshot().ready
    )
      throw Error("Recupera los catálogos antes de leer tareas.");
    const prefix = this.contactPrefix();
    const keys = this.storage.keys
      ? await this.storage.keys(prefix)
      : this.conversations.list(this.actor).map((c) => prefix + c.id);
    if (keys.length > 5000)
      throw Error("Demasiados documentos locales para esta demostración.");
    const result: LegacyWork[] = [];
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      try {
        this.conversations.get(this.actor, id);
      } catch {
        continue;
      }
      const raw = await this.storage.get(key);
      if (!raw) continue;
      if (raw.length > 2_000_000)
        throw Error("Un documento local supera el límite de lectura.");
      const d = decodeDetails(
        raw,
        this.conversations.stageOptions?.() ?? stages,
        this.conversations.catalog,
        this.conversations.team,
      );
      result.push({
        contactId: id,
        sequence: d.sequence,
        tasks: d.tasks,
        events: d.events,
      });
    }
    return result;
  }
  channelPolicy: { epoch: number; mode: Mode; defaultMode: Mode } = {
    epoch: 0,
    mode: "meta",
    defaultMode: "meta",
  };
  applyChannelPolicy(p: {
    epoch: number;
    bulkMode: Mode;
    defaultMode: Mode;
    addon: boolean;
    device: boolean;
  }) {
    this.channelPolicy = {
      epoch: p.epoch,
      mode: p.bulkMode,
      defaultMode: p.defaultMode,
    };
    this.settings = { ...this.settings, addon: p.addon, linked: p.device };
    this.stores.forEach((s) => s.refreshChannelPolicy());
    this.listeners.forEach((f) => f());
  }
  resolveMode(d: ContactData): ContactData {
    return (d.modeEpoch ?? 0) < this.channelPolicy.epoch
      ? {
          ...d,
          mode: this.channelPolicy.mode,
          modeEpoch: this.channelPolicy.epoch,
        }
      : d;
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
    this.workRepo.reconcile();
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
  private metadata: ContactData;
  private legacyTasks: ContactData["tasks"] = [];
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
    let data = {
      ...seedDetails(c, directory.now()),
      mode: directory.channelPolicy.defaultMode,
      modeEpoch: directory.channelPolicy.epoch,
    };
    if (c.id === "demo-conv-3")
      data = { ...data, tags: [...c.tags, systemImportTag] };
    this.metadata = data;
    this.state = {
      data,
      ready: false,
      saving: false,
      error: "",
      view: "normal",
      noteDraft: "",
      filter: "Todo",
    };
    this.storageKey = directory.contactPrefix() + id;
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
  refreshChannelPolicy() {
    this.patch({ data: this.state.data });
  }
  private patch(p: Partial<ContactSnapshot>) {
    if (p.data) p = { ...p, data: this.directory.resolveMode(p.data) };
    if (p.data) {
      this.metadata = {
        ...p.data,
        tasks: this.legacyTasks,
        events: p.data.events.filter((e) => !e.id.includes(":work-event:")),
      };
      this.directory.workRepo.rememberSequence(this.id, p.data.sequence);
      p = { ...p, data: this.project(this.metadata) };
    }
    this.state = { ...this.state, ...p };
    this.listeners.forEach((fn) => fn());
  }
  private project(meta: ContactData): ContactData {
    const work = this.directory.workRepo.contact(this.id);
    if (!work) return meta;
    // Work events are already newest first, including equal fixture timestamps.
    const seen = new Set<string>();
    const combined = [...work.events, ...meta.events]
      .filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      })
      .sort((a, b) => b.at - a.at);
    return {
      ...meta,
      tasks: work.tasks,
      events: combined.slice(0, 250),
      sequence: Math.max(meta.sequence, work.sequence),
    };
  }
  syncWork = () => {
    if (!this.state.ready) return;
    const next = this.project(this.metadata),
      old = this.state.data;
    if (
      JSON.stringify(next.tasks) === JSON.stringify(old.tasks) &&
      next.events.length === old.events.length &&
      next.events.every((e, i) => e.id === old.events[i]?.id) &&
      next.sequence === old.sequence
    )
      return;
    this.state = { ...this.state, data: next };
    this.listeners.forEach((fn) => fn());
  };
  private basePatch(data: ContactData) {
    const c = this.authorize();
    const p: {
      -readonly [
        K in "stage" | "tags" | "ai" | "assigned" | "lossReason"
      ]?: Conversation[K];
    } = {};
    if (c.stage !== data.stage) p.stage = data.stage;
    if (c.assigned !== data.assigned) p.assigned = data.assigned;
    if (c.ai !== data.ai) p.ai = data.ai;
    if ((c.lossReason ?? "") !== data.lossReason)
      p.lossReason = data.lossReason;
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
      JSON.stringify(d.tags) === JSON.stringify(c.tags) &&
      (c.lossReason === undefined || d.lossReason === c.lossReason)
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
          c.stage === "Perdido"
            ? (c.lossReason ?? (d.lossReason || "Sin respuesta"))
            : "",
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
        if (
          this.directory.conversations.catalog &&
          !this.directory.conversations.catalog.snapshot().ready
        )
          await this.directory.conversations.catalog.hydrate();
        if (
          this.directory.conversations.catalog &&
          !this.directory.conversations.catalog.snapshot().ready
        )
          throw Error("Recupera el catálogo antes de los detalles.");
        const raw = await this.directory.storage.get(this.storageKey);
        let data = raw
          ? decodeDetails(
              raw,
              this.directory.conversations.stageOptions?.() ?? stages,
              this.directory.conversations.catalog,
              this.directory.conversations.team,
            )
          : {
              ...this.state.data,
              mode: this.directory.channelPolicy.defaultMode,
              modeEpoch: this.directory.channelPolicy.epoch,
            };
        const current = this.authorize();
        const business = this.directory.conversations.catalog;
        if (business)
          data = { ...data, tags: business.normalizeTags(data.tags) };
        if (current.lossReason !== undefined)
          data = {
            ...data,
            lossReason: current.stage === "Perdido" ? current.lossReason : "",
          };
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
        if (
          JSON.stringify(current.tags) !==
          JSON.stringify(
            business ? business.normalizeTags(before.tags) : before.tags,
          )
        )
          data = { ...data, tags: current.tags };
        if (current.ai !== before.ai) data = { ...data, ai: current.ai };
        if (this.actor.role === "advisor" && data.assigned !== this.actor.id)
          throw new Error("Los detalles no pertenecen a tu alcance.");
        this.legacyTasks = data.tasks;
        this.directory.workRepo.rememberSequence(this.id, data.sequence);
        await this.directory.workRepo.hydrate();
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
        const business = this.directory.conversations.catalog;
        if (business && !business.snapshot().ready)
          throw Error("Recupera el catálogo antes de guardar.");
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
          decodeDetails(
            JSON.stringify(data),
            this.directory.conversations.stageOptions?.() ?? stages,
            this.directory.conversations.catalog,
            this.directory.conversations.team,
          );
          await this.directory.storage.set(
            this.storageKey,
            JSON.stringify({
              ...data,
              tasks: this.legacyTasks,
              events: data.events.filter((e) => !e.id.includes(":work-event:")),
            }),
          );
          const reasonRevoked =
            result.kind === "Etapa" &&
            data.stage === "Perdido" &&
            !(
              current.stage === "Perdido" &&
              current.lossReason === data.lossReason
            ) &&
            business &&
            !business.reasonNames().includes(data.lossReason);
          if (
            this.authorize() !== c ||
            reasonRevoked ||
            (business && !business.snapshot().ready)
          ) {
            await this.directory.storage.set(
              this.storageKey,
              JSON.stringify({
                ...old,
                tasks: this.legacyTasks,
                events: old.events.filter(
                  (e) => !e.id.includes(":work-event:"),
                ),
              }),
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
        !(
          (this.directory.conversations.catalog?.reasonNames() ??
            lossReasons) as readonly string[]
        ).includes(reason) &&
        !(d.stage === "Perdido" && d.lossReason === reason)
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
      if (!(
        assigned === null ||
        (this.directory.conversations.team
          ? this.directory.conversations.team.available(assigned)
          : isPerson(assigned))
      ))
        throw new Error("Elige una persona activa del equipo.");
      if (d.assigned === assigned) return null;
      const name =
        (
          this.directory.conversations.team?.snapshot().doc.members ?? team
        ).find((p) => p.id === assigned)?.name ?? "Sin asignar";
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
        selected.some(
          (t) =>
            !(this.directory.conversations.catalog
              ? this.directory.conversations.catalog.tag(t)?.name === t
              : allTags.includes(t)),
        )
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
      text: `${(this.directory.conversations.team?.snapshot().doc.members ?? team).find((p) => p.id === this.actor.id)?.name ?? "Tú"} tomó este chat; IA en pausa`,
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
        data: { ...d, mode, modeEpoch: this.directory.channelPolicy.epoch },
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
  private workAction(action: () => Promise<void>): Promise<void> {
    this.authorize();
    const result = this.work
      .catch(() => {})
      .then(async () => {
        if (!this.state.ready)
          throw Error("Espera a que se carguen los detalles.");
        if (this.state.view !== "normal" && this.state.view !== "empty")
          throw Error(
            this.state.view === "offline"
              ? "Sin conexión. Conservamos los datos y el borrador; reintenta al reconectar."
              : "Recupera los detalles antes de guardar.",
          );
        this.authorize();
        if (this.failNext) {
          this.failNext = false;
          throw Error("No se pudo guardar el cambio simulado. Reintenta.");
        }
        this.directory.activeWrites++;
        this.patch({ saving: true });
        try {
          await action();
        } finally {
          this.directory.activeWrites--;
          this.patch({ saving: false });
        }
      });
    this.work = result;
    return result;
  }
  note = (text: string, key = actionKey()) => {
    const draft = this.state.noteDraft;
    return this.workAction(() =>
      this.directory.workRepo.saveNote(
        { title: "", body: text, color: "bl", pin: false, contactId: this.id },
        key,
      ),
    ).then(() => {
      if (this.state.noteDraft === draft) this.patch({ noteDraft: "" });
    });
  };
  task = (title: string, due: number, assignee: string, key = actionKey()) =>
    this.workAction(() =>
      this.directory.workRepo.saveTask(
        { title, due, assignee, notes: "", contactId: this.id },
        key,
      ),
    );
  toggleTask = (id: string, key = actionKey()) =>
    this.workAction(() => {
      const task = this.directory.workRepo.getTask(id);
      if (task.contactId !== this.id)
        throw Error("Tarea no disponible en este chat.");
      return this.directory.workRepo.toggleTask(id, key);
    });
}
