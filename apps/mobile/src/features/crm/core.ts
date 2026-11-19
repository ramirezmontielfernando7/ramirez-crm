import {
  DemoConversationRepository,
  stages,
  tags,
  normalize,
  type Actor,
  type Conversation,
} from "../inbox/model";
export type Consent = "Opt-in" | "Sin respuesta" | "Baja";
export type CrmContact = Conversation & {
  consent: Consent;
  email: string;
  notes: string;
  source: string;
  amount: number;
  priority: string;
  loss: string;
};
import { stagePalette } from "../../domain/stage-colors";
export const palette = stagePalette;
export type CrmId =
  | "CRM-01"
  | "CRM-02"
  | "CRM-03"
  | "CRM-04"
  | "CRM-05"
  | "CRM-06"
  | "CRM-07"
  | "CRM-07C"
  | "CRM-07D"
  | "CRM-08"
  | "CRM-09"
  | "CRM-10"
  | "CRM-11"
  | "CRM-12"
  | "CRM-13"
  | "CRM-14"
  | "CRM-15"
  | "CRM-16"
  | "CRM-17";
export class CrmModel {
  private projections = new Map<
    string,
    {
      source: Conversation;
      extra: Partial<CrmContact> | undefined;
      value: CrmContact;
    }
  >();
  private listeners = new Set<() => void>();
  private revision = 0;
  private extra = new Map<string, Partial<CrmContact>>();
  readonly stageList: { name: string; color: string }[] = stages.map(
    (name, i) => ({ name, color: palette[i]! }),
  );
  state = {
    screen: "CRM-01" as CrmId,
    contactId: "",
    query: "",
    consent: "Todas",
    stage: "Todas",
    tag: "Todas",
    source: "Toda fuente",
    who: "Todos",
    selecting: false,
    selected: new Set<string>(),
    column: 0,
    offset: 0,
    status: "normal" as "normal" | "loading" | "empty" | "offline" | "error",
  };
  constructor(
    readonly actor: Actor,
    readonly repository = new DemoConversationRepository(),
    private changed = () => {},
  ) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.revision;
  private emit() {
    this.revision++;
    for (const fn of this.listeners) fn();
  }
  patch(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }
  navigate(screen: CrmId, id = this.state.contactId) {
    if (id) this.get(id);
    if (["CRM-07", "CRM-07C", "CRM-07D"].includes(screen)) this.manage();
    this.patch({ screen, contactId: id });
  }
  private manage() {
    if (this.actor.role === "advisor")
      throw Error("Tu perfil no permite esta acción.");
  }
  private project(c: Conversation): CrmContact {
    const extra = this.extra.get(c.id),
      cached = this.projections.get(c.id);
    if (cached?.source === c && cached.extra === extra) return cached.value;
    const value = {
      ...c,
      consent: "Sin respuesta" as Consent,
      email: "",
      notes: "",
      source:
        c.source ??
        (c.tags.includes(
          this.repository.catalog.tag("Facebook Ads")?.name ?? "Facebook Ads",
        )
          ? "Facebook Ads"
          : "Orgánico"),
      amount: 12500,
      priority: "Media",
      ...extra,
      loss:
        c.stage === "Perdido"
          ? (c.lossReason ?? extra?.loss ?? "Sin respuesta")
          : "",
    };
    if (this.projections.size < 10000 || this.projections.has(c.id))
      this.projections.set(c.id, { source: c, extra, value });
    return value;
  }
  get(id: string): CrmContact {
    return this.project(this.repository.get(this.actor, id));
  }
  list() {
    const q = normalize(this.state.query);
    return this.repository
      .list(this.actor)
      .filter((c) => !c.group && !c.campaign && !c.archived)
      .map((c) => this.project(c))
      .filter(
        (c) =>
          (!q || normalize(c.name + c.phone).includes(q)) &&
          (this.state.consent === "Todas" ||
            c.consent === this.state.consent) &&
          (this.state.stage === "Todas" || c.stage === this.state.stage) &&
          (this.state.tag === "Todas" || c.tags.includes(this.state.tag)) &&
          (this.state.source === "Toda fuente" ||
            c.source === this.state.source) &&
          (this.state.who === "Todos" ||
            (this.state.who === "Sin asignar"
              ? !c.assigned
              : c.assigned === this.state.who)),
      );
  }
  toggle(id: string) {
    this.get(id);
    const selected = new Set(this.state.selected);
    selected.has(id) ? selected.delete(id) : selected.add(id);
    this.patch({ selected, selecting: true });
  }
  cancelSelection() {
    this.patch({ selecting: false, selected: new Set() });
  }
  saveContact(input: {
    id?: string;
    name: string;
    phone: string;
    email: string;
    notes: string;
  }) {
    if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
      throw Error("Escribe un correo válido.");
    if (input.notes.length > 4000) throw Error("Notas demasiado largas.");
    const c = input.id
      ? (this.repository.editIdentity(
          this.actor,
          input.id,
          input.name,
          input.phone,
        ),
        this.repository.get(this.actor, input.id))
      : this.repository.create(this.actor, input.name, input.phone);
    this.extra.set(c.id, {
      ...this.extra.get(c.id),
      email: input.email,
      notes: input.notes,
    });
    this.changed();
    this.emit();
    return c.id;
  }
  amount(id: string, raw: string) {
    this.get(id);
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || Number(raw) > 1e9)
      throw Error("Escribe un monto válido.");
    this.extra.set(id, { ...this.extra.get(id), amount: Number(raw) });
    this.emit();
  }
  move(id: string, stage: string, loss = "") {
    this.get(id);
    if (
      stage === "Perdido" &&
      (!this.repository.catalog.snapshot().ready ||
        !this.repository.catalog.reasonNames().includes(loss))
    )
      throw Error("Selecciona un motivo de pérdida.");
    if (!this.stageList.some((s) => s.name === stage))
      throw Error("Etapa no válida.");
    this.repository.updateContact(this.actor, id, {
      stage,
      lossReason: stage === "Perdido" ? loss : "",
    });
    this.extra.set(id, {
      ...this.extra.get(id),
      loss: stage === "Perdido" ? loss : "",
    });
    this.changed();
    this.emit();
  }
  setPriority(id: string, priority: string) {
    this.get(id);
    if (!["Alta", "Media", "Baja", "Sin prioridad"].includes(priority))
      throw Error("Prioridad no válida.");
    this.extra.set(id, { ...this.extra.get(id), priority });
    this.emit();
  }
  assignContact(id: string, who: string) {
    this.manage();
    this.repository.assign(this.actor, [id], who);
    this.changed();
    this.emit();
  }
  consent(id: string, value: Consent) {
    this.manage();
    this.get(id);
    if (!["Opt-in", "Sin respuesta", "Baja"].includes(value))
      throw Error("Consentimiento inválido.");
    this.extra.set(id, { ...this.extra.get(id), consent: value });
    this.emit();
  }
  bulk(action: "tag" | "assign", value: string) {
    const ids = [...this.state.selected];
    if (!ids.length) throw Error("Selecciona contactos.");
    for (const id of ids) this.get(id);
    if (action === "assign") {
      this.manage();
      this.repository.assign(this.actor, ids, value);
    } else {
      if (!this.repository.catalog.tagNames().includes(value))
        throw Error("Etiqueta inválida.");
      for (const id of ids) {
        const c = this.get(id);
        this.repository.updateContact(this.actor, id, {
          tags: [...new Set([...c.tags, value])],
        });
      }
    }
    this.changed();
    this.emit();
  }
  archive(id: string) {
    this.get(id);
    this.repository.archive(this.actor, [id]);
    this.state.contactId = "";
    this.state.screen = "CRM-10";
    this.changed();
    this.emit();
  }
  exportSample() {
    this.manage();
    const ids = this.state.selected;
    return [
      "Nombre,Teléfono",
      ...this.list()
        .filter((c) => !ids.size || ids.has(c.id))
        .map((c) =>
          [c.name, c.phone]
            .map(
              (v) =>
                '"' +
                (/^[=+@-]/.test(v) ? "'" : "") +
                v.replaceAll('"', '""') +
                '"',
            )
            .join(","),
        ),
    ].join("\n");
  }
  addStage(name: string) {
    this.manage();
    name = name.trim();
    if (
      !name ||
      name.length > 60 ||
      this.stageList.some((s) => s.name === name) ||
      this.stageList.length >= 30
    )
      throw Error("Nombre de etapa no válido.");
    this.stageList.push({ name, color: palette[0] });
    this.repository.configureStages(
      this.actor,
      this.stageList.map((s) => s.name),
    );
    this.emit();
  }
  reorder(index: number) {
    this.manage();
    if (index <= 0 || index >= this.stageList.length) return;
    [this.stageList[index - 1], this.stageList[index]] = [
      this.stageList[index]!,
      this.stageList[index - 1]!,
    ];
    this.repository.configureStages(
      this.actor,
      this.stageList.map((s) => s.name),
    );
    this.emit();
  }
  color(name: string, color: string) {
    this.manage();
    if (!(palette as readonly string[]).includes(color))
      throw Error("Color no válido.");
    const s = this.stageList.find((s) => s.name === name);
    if (!s) throw Error("Etapa no válida.");
    s.color = color;
    this.repository.setStageColor(this.actor, name, color);
    this.emit();
  }
  deleteStage(name: string, target: string) {
    this.manage();
    if (
      name === target ||
      !this.stageList.some((s) => s.name === target) ||
      this.stageList.length < 2
    )
      throw Error("Elige otra etapa destino.");
    for (const c of this.repository.list(this.actor))
      if (c.stage === name)
        this.move(c.id, target, target === "Perdido" ? "Cambio de etapa" : "");
    const i = this.stageList.findIndex((s) => s.name === name);
    if (i < 0) throw Error("Etapa no válida.");
    this.stageList.splice(i, 1);
    this.repository.configureStages(
      this.actor,
      this.stageList.map((s) => s.name),
    );
    this.patch({
      column: Math.min(this.state.column, this.stageList.length - 1),
    });
  }
  importSample(consent: "yes" | "unknown" | null) {
    if (consent === null) throw Error("Indica si aceptaron recibir mensajes.");
    const id = this.saveContact({
      name: "Contacto importado ficticio",
      phone: "+52 55 5550 9999",
      email: "importado@example.invalid",
      notes: "Muestra local, sin acceso a archivos.",
    });
    this.extra.set(id, {
      ...this.extra.get(id),
      consent:
        this.get(id).consent === "Baja"
          ? "Baja"
          : consent === "yes"
            ? "Opt-in"
            : "Sin respuesta",
    });
    this.emit();
    return id;
  }
}
