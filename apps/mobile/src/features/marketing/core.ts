import { OptOutStore } from "../optout/core";
import type { StoragePort } from "../../services/storage";
import type { TeamRepository } from "../team/core";
import type { DemoConversationRepository } from "../inbox/model";
import { TemplateStore, variables } from "../templates/core";
import { businessDay } from "../results/core";
export const importSamples = Object.freeze([
  Object.freeze({
    id: "demo-base-csv",
    name: "base-ficticia.csv",
    columns: Object.freeze(["telefono", "nombre"]),
    rows: Object.freeze(
      [
        ["+15550108001", "Ana de prueba"],
        ["+15550108002", "Bruno de prueba"],
        ["+15550108001", "Ana duplicada"],
        ["123", "Número incompleto"],
        ["", "Sin teléfono"],
        ["+15550108003", "Carla de prueba"],
      ].map((r) => Object.freeze(r)),
    ),
  }),
  Object.freeze({
    id: "demo-base-xlsx",
    name: "base-ficticia.xlsx",
    columns: Object.freeze(["Nombre", "Movil"]),
    rows: Object.freeze(
      [
        ["Ana actualizada", "+15550108001"],
        ["Diego de prueba", "+15550108004"],
        ["Elena de prueba", "+15550108005"],
      ].map((r) => Object.freeze(r)),
    ),
  }),
]);
export type Settings = Readonly<{
  threshold: number;
  frequencyDays: number;
  marketingCents: number;
  utilityCents: number;
}>;
export type Person = Readonly<{
  id: string;
  phone: string;
  name: string;
  optIn: boolean;
  creator: string;
}>;
export type Audience = Readonly<{
  id: string;
  name: string;
  at: number;
  members: readonly string[];
  created: number;
  updated: number;
  duplicates: number;
  invalid: number;
  issues: readonly { line: number; reason: string }[];
}>;
export type Input = Readonly<{
  name: string;
  source: "audience" | "all" | "tag";
  audience: string;
  tag: string;
  template: string;
  values: readonly string[];
  when: "now" | "scheduled";
  scheduledAt: number;
  testPhone: string;
}>;
export type Status =
  "draft" | "scheduled" | "running" | "paused" | "done" | "cancelled";
export const statusLabels: Record<Status, string> = {
  draft: "Borrador",
  scheduled: "Programada",
  running: "En curso",
  paused: "Pausada",
  done: "Terminada",
  cancelled: "Cancelada",
};
export type Recipient = Readonly<{
  id: string;
  status:
    | "pending"
    | "delivered"
    | "read"
    | "replied"
    | "failed"
    | "skipped"
    | "cancelled";
  at: number;
  reason: string;
}>;
export const recipientLabels: Record<Recipient["status"], string> = {
  pending: "Pendiente",
  delivered: "Entregado",
  read: "Leído",
  replied: "Respondió",
  failed: "Falló",
  skipped: "Omitido",
  cancelled: "Cancelado",
};
export type Campaign = Readonly<{
  id: string;
  creator: string;
  at: number;
  revision: number;
  input: Input;
  step: number;
  status: Status;
  templateRevision: number;
  category: "UTILITY" | "MARKETING";
  rate: number;
  recipients: readonly Recipient[];
  reason: string;
}>;
type Doc = Readonly<{
  org: string;
  revision: number;
  sequence: number;
  settings: Settings;
  people: readonly Person[];
  audiences: readonly Audience[];
  campaigns: readonly Campaign[];
  receipts: readonly { key: string; signature: string; result: string }[];
}>;
export type Plan = Readonly<{
  ids: readonly string[];
  skipped: number;
  estimate: number;
  signature: string;
  templateRevision: number;
}>;
const queues = new WeakMap<TeamRepository, Map<string, Promise<unknown>>>(),
  peers = new WeakMap<TeamRepository, Set<MarketingStore>>();
const freeze = <T>(o: T): T => {
  if (o && typeof o === "object") {
    Object.values(o).forEach(freeze);
    Object.freeze(o);
  }
  return o;
};
const validId = (v: unknown) =>
  typeof v === "string" && /^demo-(conv|new)-\d+$/.test(v);
const exact = (value: object, keys: readonly string[]) =>
  Object.keys(value).every((k) => keys.includes(k));
const bounded = (v: unknown, max: number) =>
  typeof v === "string" && v.length <= max;
const stamp = (v: number) =>
  Number.isFinite(v) && v >= 0 && v <= 8640000000000000;
const settingsValid = (s: Settings) =>
  s &&
  Number.isInteger(s.threshold) &&
  s.threshold >= 1 &&
  s.threshold <= 100 &&
  Number.isInteger(s.frequencyDays) &&
  s.frequencyDays >= 0 &&
  s.frequencyDays <= 365 &&
  Number.isSafeInteger(s.marketingCents) &&
  s.marketingCents >= 0 &&
  s.marketingCents <= 100000 &&
  Number.isSafeInteger(s.utilityCents) &&
  s.utilityCents >= 0 &&
  s.utilityCents <= 100000;
export const emptyInput = (audience = ""): Input => ({
  name: "Campaña de prueba",
  source: audience ? "audience" : "all",
  audience,
  tag: "",
  template: "",
  values: ["$name", "martes", "10:00"],
  when: "now",
  scheduledAt: 0,
  testPhone: "+15550108001",
});
export class MarketingStore {
  readonly key: string;
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private refs = 0;
  private state: Readonly<{ ready: boolean; error: string; doc: Doc }>;
  constructor(
    readonly team: TeamRepository,
    readonly actor: string,
    readonly conversations: DemoConversationRepository,
    readonly templates: TemplateStore,
    private io: StoragePort,
    private now = Date.now,
    private enabled: () => boolean = () => true,
  ) {
    if (
      conversations.catalog?.organizationId !== team.organizationId ||
      templates.team.organizationId !== team.organizationId ||
      templates.actor !== actor
    )
      throw Error("Ámbito de Marketing no válido.");
    this.key = `dashfort.demo.marketing.v1.${team.organizationId}`;
    this.state = {
      ready: false,
      error: "",
      doc: freeze({
        org: team.organizationId,
        revision: 0,
        sequence: 0,
        settings: {
          threshold: 10,
          frequencyDays: 7,
          marketingCents: 80,
          utilityCents: 30,
        },
        people: [],
        audiences: [],
        campaigns: [],
        receipts: [],
      }),
    };
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
  retain() {
    this.refs++;
    let s = peers.get(this.team);
    if (!s) {
      s = new Set();
      peers.set(this.team, s);
    }
    s.add(this);
    return () => {
      if (--this.refs === 0) s!.delete(this);
    };
  }
  private manage() {
    const a = this.team.actor(this.actor);
    if (!this.enabled()) throw Error("Marketing está deshabilitado.");
    if (a.role === "advisor") throw Error("Tu rol no administra Marketing.");
    return a;
  }
  private check() {
    this.manage();
    if (!this.state.ready) throw Error("Recupera Marketing primero.");
  }
  private decode(raw: string): Doc {
    if (raw.length > 6000000) throw Error("Marketing local demasiado grande.");
    const d = JSON.parse(raw) as Doc;
    if (
      !d ||
      !exact(d, [
        "org",
        "revision",
        "sequence",
        "settings",
        "people",
        "audiences",
        "campaigns",
        "receipts",
      ]) ||
      d.org !== this.team.organizationId ||
      !Number.isSafeInteger(d.revision) ||
      d.revision < 0 ||
      !Number.isSafeInteger(d.sequence) ||
      d.sequence < 0 ||
      !settingsValid(d.settings) ||
      !exact(d.settings, [
        "threshold",
        "frequencyDays",
        "marketingCents",
        "utilityCents",
      ]) ||
      !Array.isArray(d.people) ||
      d.people.length > 1000 ||
      !Array.isArray(d.audiences) ||
      d.audiences.length > 100 ||
      !Array.isArray(d.campaigns) ||
      d.campaigns.length > 200 ||
      !Array.isArray(d.receipts) ||
      d.receipts.length > 2000
    )
      throw Error("Marketing ficticio no válido.");
    for (const p of d.people)
      if (
        !p ||
        !exact(p, ["id", "phone", "name", "optIn", "creator"]) ||
        !validId(p.id) ||
        !/^\+1555010\d{4}$/.test(p.phone) ||
        !bounded(p.name, 80) ||
        !p.name.trim() ||
        typeof p.optIn !== "boolean" ||
        !this.team.known(p.creator)
      )
        throw Error("Persona importada no válida.");
    if (
      new Set(d.people.map((p) => p.id)).size !== d.people.length ||
      new Set(d.people.map((p) => p.phone)).size !== d.people.length
    )
      throw Error("Persona duplicada.");
    for (const a of d.audiences)
      if (
        !a ||
        !exact(a, [
          "id",
          "name",
          "at",
          "members",
          "created",
          "updated",
          "duplicates",
          "invalid",
          "issues",
        ]) ||
        !/^demo-audience-\d+$/.test(a.id) ||
        !bounded(a.name, 80) ||
        !a.name.trim() ||
        !stamp(a.at) ||
        !Array.isArray(a.members) ||
        new Set(a.members).size !== a.members.length ||
        !a.members.every((id: string) => d.people.some((p) => p.id === id)) ||
        ![a.created, a.updated, a.duplicates, a.invalid].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ) ||
        a.created + a.updated !== a.members.length ||
        !Array.isArray(a.issues) ||
        a.issues.length !== a.invalid ||
        a.issues.some(
          (i: { line: number; reason: string }) =>
            !Number.isSafeInteger(i.line) ||
            i.line < 2 ||
            !bounded(i.reason, 100),
        )
      )
        throw Error("Audiencia no válida.");
    for (const c of d.campaigns) {
      if (
        !c ||
        !exact(c, [
          "id",
          "creator",
          "at",
          "revision",
          "input",
          "step",
          "status",
          "templateRevision",
          "category",
          "rate",
          "recipients",
          "reason",
        ]) ||
        !/^demo-campaign-\d+$/.test(c.id) ||
        !this.team.known(c.creator) ||
        !stamp(c.at) ||
        !Number.isSafeInteger(c.revision) ||
        c.revision < 1 ||
        !Number.isInteger(c.step) ||
        c.step < 1 ||
        c.step > 5 ||
        !Object.keys(statusLabels).includes(c.status) ||
        !["UTILITY", "MARKETING"].includes(c.category) ||
        !Number.isSafeInteger(c.templateRevision) ||
        c.templateRevision < 0 ||
        !Number.isSafeInteger(c.rate) ||
        c.rate < 0 ||
        c.rate > 100000 ||
        !bounded(c.reason, 200) ||
        !Array.isArray(c.recipients) ||
        c.recipients.length > 1000 ||
        new Set(c.recipients.map((r: Recipient) => r.id)).size !==
          c.recipients.length ||
        c.recipients.some(
          (r: Recipient) =>
            !exact(r, ["id", "status", "at", "reason"]) ||
            !validId(r.id) ||
            !d.people.some((p) => p.id === r.id) ||
            ![
              "pending",
              "delivered",
              "read",
              "replied",
              "failed",
              "skipped",
              "cancelled",
            ].includes(r.status) ||
            !stamp(r.at) ||
            !bounded(r.reason, 100),
        )
      )
        throw Error("Campaña no válida.");
      this.validateInput(c.input);
    }
    for (const xs of [d.audiences, d.campaigns])
      if (new Set(xs.map((x) => x.id)).size !== xs.length)
        throw Error("Identidad duplicada.");
    if (
      new Set(d.receipts.map((r) => r.key)).size !== d.receipts.length ||
      d.receipts.some(
        (r) =>
          !bounded(r.key, 120) ||
          !r.key ||
          !bounded(r.signature, 20000) ||
          !bounded(r.result, 100),
      )
    )
      throw Error("Recibo no válido.");
    return freeze(d);
  }
  private validateInput(i: Input) {
    if (
      !i ||
      !exact(i, [
        "name",
        "source",
        "audience",
        "tag",
        "template",
        "values",
        "when",
        "scheduledAt",
        "testPhone",
      ]) ||
      !bounded(i.name, 80) ||
      !i.name.trim() ||
      !["audience", "all", "tag"].includes(i.source) ||
      !bounded(i.audience, 80) ||
      !bounded(i.tag, 80) ||
      !bounded(i.template, 64) ||
      !Array.isArray(i.values) ||
      i.values.length !== 3 ||
      i.values.some((v) => !bounded(v, 200)) ||
      !["now", "scheduled"].includes(i.when) ||
      !stamp(i.scheduledAt) ||
      !/^\+1555010\d{4}$/.test(i.testPhone)
    )
      throw Error("Datos de campaña no válidos.");
  }
  private optOutIds: readonly string[] = [];
  private async readOptOuts() {
    const ledger = new OptOutStore(this.team, this.actor, this.io);
    await ledger.hydrate();
    if (!ledger.snapshot().ready)
      throw Error("No se pudo recuperar el consentimiento.");
    this.optOutIds = ledger.snapshot().doc.events.map((e) => e.contact);
    this.conversations.restoreOptOut(this.manage(), this.optOutIds);
  }
  private project(d: Doc, updated: readonly string[] = []) {
    const a = this.manage();
    this.conversations.importFictitiousBatch(
      a,
      d.people.map((p) => ({ ...p, updateName: updated.includes(p.id) })),
    );
    this.conversations.restoreOptOut(a, this.optOutIds);
  }
  hydrate = () => {
    if (this.state.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        await this.team.hydrate();
        this.manage();
        await this.templates.hydrate();
        if (!this.templates.snapshot().ready)
          throw Error("Plantillas no recuperadas.");
        await this.readOptOuts();
        const raw = await this.io.get(this.key),
          incoming = raw ? this.decode(raw) : this.state.doc,
          doc =
            incoming.revision >= this.state.doc.revision
              ? incoming
              : this.state.doc;
        this.project(doc);
        this.patch({ ready: true, error: "", doc });
      } catch {
        this.patch({
          ready: false,
          error:
            "No se pudo recuperar Marketing. Reintenta sin reemplazar los datos.",
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
  private change(
    key: string,
    intent: unknown,
    fn: (d: Doc) => { doc: Doc; result: string; updated?: readonly string[] },
  ) {
    if (!key || key.length > 120)
      return Promise.reject(Error("Identificador no válido."));
    const signature = JSON.stringify([this.actor, intent]);
    let q = queues.get(this.team);
    if (!q) {
      q = new Map();
      queues.set(this.team, q);
    }
    const job = (q.get(this.key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        this.check();
        await this.readOptOuts();
        const raw = await this.io.get(this.key),
          d = raw ? this.decode(raw) : this.state.doc,
          old = d.receipts.find((r) => r.key === key);
        if (old) {
          if (old.signature !== signature)
            throw Error("Identificador de otra operación.");
          this.project(d);
          this.patch({ doc: d });
          return old.result;
        }
        if (d.receipts.length >= 2000)
          throw Error("Límite de operaciones; historial conservado.");
        const r = fn(d),
          next = this.decode(
            JSON.stringify({
              ...r.doc,
              revision: d.revision + 1,
              receipts: [...d.receipts, { key, signature, result: r.result }],
            }),
          );
        await this.io.set(this.key, JSON.stringify(next));
        this.manage();
        this.project(next, r.updated);
        this.patch({ doc: next, error: "" });
        for (const p of peers.get(this.team) ?? []) {
          if (p.state.doc.revision <= next.revision) {
            try {
              p.optOutIds = this.optOutIds;
              p.project(next);
              p.patch({ doc: next });
            } catch {
              p.patch({
                ready: false,
                error: "Los permisos cambiaron. Recupera la sesión.",
              });
            }
          }
        }
        return r.result;
      });
    q.set(this.key, job);
    return job;
  }
  audiences() {
    this.check();
    return this.state.doc.audiences;
  }
  audience(id: string) {
    const a = this.audiences().find((a) => a.id === id);
    if (!a) throw Error("Base no disponible.");
    return a;
  }
  importFile(
    sampleId: string,
    name: string,
    optIn: boolean,
    phoneColumn: string,
    nameColumn: string,
    key: string,
  ) {
    return this.change(
      key,
      ["import", sampleId, name, optIn, phoneColumn, nameColumn],
      (d) => {
        const file = importSamples.find((f) => f.id === sampleId);
        if (
          !file ||
          typeof optIn !== "boolean" ||
          !name.trim() ||
          name.length > 80 ||
          d.audiences.some((a) => a.name === name.trim())
        )
          throw Error("Elige una muestra y un nombre único para la base.");
        const pi = (file.columns as readonly string[]).indexOf(phoneColumn),
          ni = (file.columns as readonly string[]).indexOf(nameColumn);
        if (pi < 0 || ni < 0 || pi === ni)
          throw Error("Mapea teléfono y nombre a columnas distintas.");
        const people = [...d.people],
          members: string[] = [],
          issues: { line: number; reason: string }[] = [];
        let created = 0,
          updated = 0,
          duplicates = 0;
        const seen = new Set<string>();
        file.rows.forEach((row, index) => {
          const digits = (row[pi] ?? "").replace(/\D/g, ""),
            label = (row[ni] ?? "").trim();
          if (!/^1555010\d{4}$/.test(digits) || !label || label.length > 80) {
            issues.push({
              line: index + 2,
              reason: !digits
                ? "Sin teléfono"
                : !label
                  ? "Sin nombre"
                  : "Teléfono ficticio inválido",
            });
            return;
          }
          if (seen.has(digits)) {
            duplicates++;
            return;
          }
          seen.add(digits);
          const phone = "+" + digits,
            prior = people.find((p) => p.phone === phone),
            existing = this.conversations
              .list(this.manage())
              .find((c) => c.phone.replace(/\D/g, "") === digits);
          const id = prior?.id ?? existing?.id ?? `demo-new-8${digits}`,
            p: Person = {
              id,
              phone,
              name: label,
              optIn,
              creator: prior?.creator ?? this.actor,
            };
          if (prior) {
            people[people.indexOf(prior)] = p;
            updated++;
          } else {
            people.push(p);
            if (existing) updated++;
            else created++;
          }
          members.push(id);
        });
        if (!members.length) throw Error("La muestra no tiene filas válidas.");
        const sequence = d.sequence + 1,
          id = `demo-audience-${sequence}`,
          a: Audience = {
            id,
            name: name.trim(),
            at: this.now(),
            members,
            created,
            updated,
            duplicates,
            invalid: issues.length,
            issues,
          };
        return {
          doc: { ...d, sequence, people, audiences: [...d.audiences, a] },
          result: id,
          updated: members,
        };
      },
    );
  }
  start(audience: string | undefined, key: string) {
    return this.change(key, ["start", audience ?? ""], (d) => {
      if (audience && !d.audiences.some((a) => a.id === audience))
        throw Error("Base no disponible.");
      const sequence = d.sequence + 1,
        id = `demo-campaign-${sequence}`,
        c: Campaign = {
          id,
          creator: this.actor,
          at: this.now(),
          revision: 1,
          input: emptyInput(audience),
          step: 1,
          status: "draft",
          templateRevision: 0,
          category: "MARKETING",
          rate: 0,
          recipients: [],
          reason: "",
        };
      return {
        doc: { ...d, sequence, campaigns: [...d.campaigns, c] },
        result: id,
      };
    });
  }
  rawCampaign(id: string) {
    this.check();
    const c = this.state.doc.campaigns.find((c) => c.id === id);
    if (!c) throw Error("Campaña no disponible.");
    return c;
  }
  private templateProblem(c: Campaign) {
    try {
      this.templates.assertApproved(c.input.template, c.templateRevision);
      return "";
    } catch {
      return "La plantilla está pausada, cambió o no está aprobada.";
    }
  }
  campaign(id: string) {
    const c = this.rawCampaign(id),
      reason = ["running", "scheduled"].includes(c.status)
        ? this.templateProblem(c)
        : "";
    return reason ? { ...c, status: "paused" as const, reason } : c;
  }
  campaigns() {
    this.check();
    return this.state.doc.campaigns.map((c) => this.campaign(c.id));
  }
  saveDraft(
    id: string,
    input: Input,
    step: number,
    expected: number,
    key: string,
  ) {
    const copy = { ...input, values: [...input.values] };
    return this.change(key, ["draft", id, copy, step, expected], (d) => {
      const c = d.campaigns.find((c) => c.id === id);
      if (
        !c ||
        c.status !== "draft" ||
        c.creator !== this.actor ||
        c.revision !== expected
      )
        throw Error("El borrador cambió o pertenece a otra persona.");
      this.validateInput(copy);
      if (!Number.isInteger(step) || step < 1 || step > 5)
        throw Error("Paso no válido.");
      return {
        doc: {
          ...d,
          campaigns: d.campaigns.map((x) =>
            x.id === id
              ? { ...c, input: copy, step, revision: c.revision + 1 }
              : x,
          ),
        },
        result: id,
      };
    });
  }
  private eligible(
    d: Doc,
    ids: readonly string[],
    category: "UTILITY" | "MARKETING",
  ) {
    return ids.filter((id) => {
      const person = d.people.find((p) => p.id === id);
      if (!person?.optIn) return false;
      try {
        const c = this.conversations.get(this.manage(), id);
        if (c.optedOut || c.archived || c.group) return false;
      } catch {
        return false;
      }
      if (
        category === "MARKETING" &&
        d.campaigns.some(
          (c) =>
            c.category === "MARKETING" &&
            c.recipients.some(
              (r) =>
                r.id === id &&
                ["delivered", "read", "replied"].includes(r.status) &&
                this.now() - r.at < d.settings.frequencyDays * 86400000,
            ),
        )
      )
        return false;
      return true;
    });
  }
  private planFor(d: Doc, c: Campaign): Plan {
    const i = c.input;
    this.templates.assertApproved(i.template);
    const t = this.templates.get(i.template);
    let ids =
      i.source === "audience"
        ? d.audiences.find((a) => a.id === i.audience)?.members
        : i.source === "all"
          ? d.people.map((p) => p.id)
          : d.people
              .filter((p) => {
                try {
                  return this.conversations
                    .get(this.manage(), p.id)
                    .tags.includes(
                      this.conversations.catalog.tag(i.tag)?.name ??
                        "__etiqueta_no_disponible__",
                    );
                } catch {
                  return false;
                }
              })
              .map((p) => p.id);
    if (!ids) throw Error("Elige una base disponible.");
    const allowed = this.eligible(d, ids, t.category);
    if (!allowed.length)
      throw Error("No hay destinatarios con opt-in disponibles.");
    for (const id of allowed)
      this.templates.render(
        t.id,
        i.values.map((v) =>
          v === "$name"
            ? this.conversations.get(this.manage(), id).name.split(" ")[0]!
            : v,
        ),
      );
    if (
      i.when === "scheduled" &&
      (i.scheduledAt <= this.now() ||
        i.scheduledAt > this.now() + 366 * 86400000)
    )
      throw Error("Programa una fecha futura dentro de un año.");
    const estimate =
        allowed.length *
        (t.category === "MARKETING"
          ? d.settings.marketingCents
          : d.settings.utilityCents),
      signature = JSON.stringify([
        c.id,
        c.revision,
        allowed,
        t.id,
        t.revision,
        i,
        d.settings,
      ]);
    return {
      ids: allowed,
      skipped: ids.length - allowed.length,
      estimate,
      signature,
      templateRevision: t.revision,
    };
  }
  plan(id: string) {
    this.check();
    return this.planFor(this.state.doc, this.rawCampaign(id));
  }
  confirm(id: string, token: string, count: string, key: string) {
    return this.change(key, ["confirm", id, token, count], (d) => {
      const c = d.campaigns.find((c) => c.id === id);
      if (!c || c.status !== "draft" || c.creator !== this.actor)
        throw Error("Borrador no disponible.");
      const p = this.planFor(d, c);
      if (token !== p.signature || count !== String(p.ids.length))
        throw Error(
          "Cambió la revisión o no coincide el número de destinatarios.",
        );
      const t = this.templates.get(c.input.template);
      return {
        doc: {
          ...d,
          campaigns: d.campaigns.map((x) =>
            x.id === id
              ? {
                  ...c,
                  status: c.input.when === "now" ? "running" : "scheduled",
                  templateRevision: t.revision,
                  category: t.category,
                  rate:
                    t.category === "MARKETING"
                      ? d.settings.marketingCents
                      : d.settings.utilityCents,
                  revision: c.revision + 1,
                  recipients: p.ids.map((id) => ({
                    id,
                    status: "pending",
                    at: 0,
                    reason: "",
                  })),
                }
              : x,
          ),
        },
        result: id,
      };
    });
  }
  control(
    id: string,
    action: "pause" | "resume" | "cancel",
    expected: number,
    key: string,
  ) {
    return this.change(key, ["control", id, action, expected], (d) => {
      if (!["pause", "resume", "cancel"].includes(action))
        throw Error("Acción de campaña no válida.");
      const c = d.campaigns.find((c) => c.id === id);
      if (!c || c.revision !== expected) throw Error("La campaña cambió.");
      const effective =
        ["running", "scheduled"].includes(c.status) && this.templateProblem(c)
          ? "paused"
          : c.status;
      if (action === "cancel") {
        if (["done", "cancelled"].includes(c.status))
          throw Error("Campaña ya finalizada.");
        return {
          doc: {
            ...d,
            campaigns: d.campaigns.map((x) =>
              x.id === id
                ? {
                    ...c,
                    status: "cancelled",
                    reason: "Cancelación ficticia confirmada",
                    revision: c.revision + 1,
                    recipients: c.recipients.map((r: Recipient) =>
                      r.status === "pending"
                        ? { ...r, status: "cancelled" }
                        : r,
                    ),
                  }
                : x,
            ),
          },
          result: id,
        };
      }
      if (action === "pause" && !["running", "scheduled"].includes(effective))
        throw Error("No se puede pausar este estado.");
      if (action === "resume" && effective !== "paused")
        throw Error("No está pausada.");
      if (action === "resume") this.templates.assertApproved(c.input.template);
      return {
        doc: {
          ...d,
          campaigns: d.campaigns.map((x) =>
            x.id === id
              ? {
                  ...c,
                  status:
                    action === "pause"
                      ? "paused"
                      : c.input.when === "scheduled" &&
                          c.input.scheduledAt > this.now()
                        ? "scheduled"
                        : c.recipients.every((r) => r.status !== "pending")
                          ? "done"
                          : "running",
                  templateRevision:
                    action === "resume"
                      ? this.templates.revision(c.input.template)
                      : c.templateRevision,
                  reason: action === "pause" ? "Pausa manual ficticia" : "",
                  revision: c.revision + 1,
                }
              : x,
          ),
        },
        result: id,
      };
    });
  }
  duplicate(id: string, key: string) {
    return this.change(key, ["duplicate", id], (d) => {
      const c = d.campaigns.find((c) => c.id === id);
      if (!c) throw Error("Campaña no disponible.");
      const sequence = d.sequence + 1,
        next = `demo-campaign-${sequence}`;
      return {
        doc: {
          ...d,
          sequence,
          campaigns: [
            ...d.campaigns,
            {
              ...c,
              id: next,
              creator: this.actor,
              at: this.now(),
              revision: 1,
              input: {
                ...c.input,
                name: (c.input.name + " · copia").slice(0, 80),
                when: "now",
                scheduledAt: 0,
              },
              step: 1,
              status: "draft",
              recipients: [],
              reason: "",
              templateRevision: 0,
              rate: 0,
            },
          ],
        },
        result: next,
      };
    });
  }
  advance(
    id: string,
    outcome: "delivered" | "read" | "replied" | "failed",
    key: string,
  ) {
    return this.change(key, ["advance", id, outcome], (d) => {
      if (!["delivered", "read", "replied", "failed"].includes(outcome))
        throw Error("Resultado no válido.");
      const c = d.campaigns.find((c) => c.id === id);
      if (!c || !["running", "scheduled"].includes(c.status))
        throw Error("Campaña sin avance disponible.");
      const problem = this.templateProblem(c);
      if (problem)
        return {
          doc: {
            ...d,
            campaigns: d.campaigns.map((x) =>
              x.id === id
                ? {
                    ...c,
                    status: "paused",
                    reason: problem,
                    revision: c.revision + 1,
                  }
                : x,
            ),
          },
          result: id,
        };
      if (c.input.when === "scheduled" && c.input.scheduledAt > this.now())
        throw Error("La hora ficticia todavía no llegó.");
      const r = c.recipients.find((r) => r.status === "pending");
      if (!r) throw Error("Sin pendientes.");
      const eligible = this.eligible(d, [r.id], c.category).length > 0,
        updated: Recipient = {
          ...r,
          status: eligible ? outcome : "skipped",
          at: this.now(),
          reason: eligible
            ? outcome === "failed"
              ? "Fallo de prueba"
              : ""
            : "Sin consentimiento, baja o frecuencia",
        },
        recipients = c.recipients.map((x) => (x.id === r.id ? updated : x)),
        processed = recipients.filter((r) =>
          ["delivered", "read", "replied", "failed"].includes(r.status),
        ),
        fail = processed.filter((r) => r.status === "failed").length,
        paused =
          processed.length > 0 &&
          (fail / processed.length) * 100 > d.settings.threshold;
      const next: Campaign = {
        ...c,
        recipients,
        status: paused
          ? "paused"
          : recipients.some((r) => r.status === "pending")
            ? "running"
            : "done",
        reason: paused ? "Umbral de fallos ficticio superado" : "",
        revision: c.revision + 1,
      };
      return {
        doc: {
          ...d,
          campaigns: d.campaigns.map((x) => (x.id === id ? next : x)),
        },
        result: id,
      };
    });
  }
  configure(settings: Settings, expected: number, key: string) {
    const copy = { ...settings };
    return this.change(key, ["settings", copy, expected], (d) => {
      if (!settingsValid(copy))
        throw Error("Revisa umbral, frecuencia y tarifas en centavos.");
      if (d.revision !== expected) throw Error("La configuración cambió.");
      return { doc: { ...d, settings: copy }, result: "settings" };
    });
  }
  usage(templateId: string) {
    this.check();
    return this.state.doc.campaigns.filter(
      (c) => c.input.template === templateId,
    ).length;
  }
  campaignsForPeriod(period: "7" | "30" | "month") {
    this.check();
    const today = businessDay(this.now()),
      from =
        period === "month"
          ? today.slice(0, 8) + "01"
          : businessDay(this.now() - (Number(period) - 1) * 86400000),
      lo = Date.parse(from + "T00:00:00-05:00"),
      hi = Date.parse(today + "T23:59:59.999-05:00");
    return this.campaigns().filter(
      (c) =>
        (c.at >= lo && c.at <= hi) ||
        c.recipients.some((r) => r.at >= lo && r.at <= hi),
    );
  }
  metrics(period: "7" | "30" | "month", reported = false) {
    this.check();
    const today = businessDay(this.now()),
      from =
        period === "month"
          ? today.slice(0, 8) + "01"
          : businessDay(this.now() - (Number(period) - 1) * 86400000);
    const fromMs = Date.parse(from + "T00:00:00-05:00"),
      toMs = Date.parse(today + "T23:59:59.999-05:00");
    let sent = 0,
      delivered = 0,
      read = 0,
      replied = 0,
      failed = 0,
      skipped = 0,
      cents = 0;
    for (const c of this.state.doc.campaigns)
      for (const r of c.recipients) {
        if (!r.at || businessDay(r.at) < from || businessDay(r.at) > today)
          continue;
        if (["delivered", "read", "replied"].includes(r.status)) {
          sent++;
          delivered++;
          cents += reported ? Math.round(c.rate * 0.9) : c.rate;
        }
        if (["read", "replied"].includes(r.status)) read++;
        if (r.status === "replied") replied++;
        if (r.status === "failed") failed++;
        if (r.status === "skipped") skipped++;
      }
    return { sent, delivered, read, replied, failed, skipped, cents };
  }
}
