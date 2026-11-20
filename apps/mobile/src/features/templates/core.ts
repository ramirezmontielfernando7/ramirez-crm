import type { StoragePort } from "../../services/storage";
import type { TeamRepository } from "../team/core";
import { templates as legacyTemplates } from "../chat/model";
export const statuses = ["approved", "pending", "rejected", "paused"] as const;
export type TemplateStatus = (typeof statuses)[number];
export const statusLabels: Record<TemplateStatus, string> = {
  approved: "Aprobada",
  pending: "En revisión",
  rejected: "Rechazada",
  paused: "Pausada",
};
export type TemplateInput = Readonly<{
  name: string;
  category: "UTILITY" | "MARKETING";
  header: "none" | "text" | "image";
  headerText: string;
  body: string;
  footer: string;
  button: "none" | "quick" | "link";
  buttonText: string;
}>;
export type Template = TemplateInput &
  Readonly<{
    id: string;
    status: TemplateStatus;
    reason: string;
    revision: number;
  }>;
type Doc = Readonly<{
  org: string;
  revision: number;
  rows: readonly Template[];
  receipts: readonly { key: string; signature: string; id: string }[];
}>;
const queues = new WeakMap<TeamRepository, Map<string, Promise<unknown>>>(),
  peers = new WeakMap<TeamRepository, Set<TemplateStore>>();
export function variables(body: string) {
  const nums = [...body.matchAll(/\{\{([1-9][0-9]*)\}\}/g)].map((m) =>
      Number(m[1]),
    ),
    unique = [...new Set(nums)].sort((a, b) => a - b);
  if (
    /[{}]/.test(body.replace(/\{\{[1-9][0-9]*\}\}/g, "")) ||
    unique.length > 3 ||
    unique.some((n, i) => n !== i + 1)
  )
    throw Error("Usa variables consecutivas {{1}}, {{2}}, {{3}}.");
  return unique.length;
}
export function validateInput(t: TemplateInput) {
  if (
    !t ||
    !["UTILITY", "MARKETING"].includes(t.category) ||
    !["none", "text", "image"].includes(t.header) ||
    !["none", "quick", "link"].includes(t.button) ||
    typeof t.name !== "string" ||
    !t.name ||
    t.name.length > 64 ||
    typeof t.headerText !== "string" ||
    t.headerText.length > 60 ||
    /[{}]/.test(t.headerText) ||
    typeof t.body !== "string" ||
    !t.body.trim() ||
    t.body.length > 1024 ||
    typeof t.footer !== "string" ||
    t.footer.length > 60 ||
    /[{}]/.test(t.footer) ||
    typeof t.buttonText !== "string" ||
    t.buttonText.length > 25 ||
    (t.header === "text" && !t.headerText.trim()) ||
    (t.button !== "none" && !t.buttonText.trim())
  )
    throw Error("Completa la plantilla dentro de sus límites.");
  variables(t.body);
}
const freeze = (d: Doc): Doc =>
  Object.freeze({
    ...d,
    rows: Object.freeze(d.rows.map((r) => Object.freeze({ ...r }))),
    receipts: Object.freeze(d.receipts.map((r) => Object.freeze({ ...r }))),
  });
export class TemplateStore {
  readonly key: string;
  private state: Readonly<{ ready: boolean; error: string; doc: Doc }>;
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private refs = 0;
  constructor(
    readonly team: TeamRepository,
    readonly actor: string,
    private io: StoragePort,
    private adminEnabled: () => boolean = () => true,
  ) {
    this.key = `dashfort.demo.templates.v1.${team.organizationId}`;
    this.state = {
      ready: false,
      error: "",
      doc: freeze({
        org: team.organizationId,
        revision: 0,
        receipts: [],
        rows: [
          ...legacyTemplates.map((t) => ({
            id: t.id,
            name: t.id,
            category: (t.id === "recordatorio_cita"
              ? "UTILITY"
              : "MARKETING") as Template["category"],
            header: "none" as const,
            headerText: "",
            body: t.body,
            footer: "",
            button: "none" as const,
            buttonText: "",
            status: (t.approved ? "approved" : "pending") as TemplateStatus,
            reason: "",
            revision: 1,
          })),
          {
            id: "cotizacion_lista",
            name: "cotizacion_lista",
            category: "UTILITY",
            header: "none",
            headerText: "",
            body: "Tu cotización {{1}} ya está lista.",
            footer: "",
            button: "none",
            buttonText: "",
            status: "rejected",
            reason:
              "La variable aparece sin texto de apoyo. Muestra de rechazo ficticio.",
            revision: 1,
          },
        ],
      }),
    };
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
  private decode(raw: string): Doc {
    if (raw.length > 2000000) throw Error("Catálogo demasiado grande.");
    const d = JSON.parse(raw) as Doc;
    if (
      !d ||
      d.org !== this.team.organizationId ||
      !Number.isSafeInteger(d.revision) ||
      d.revision < 0 ||
      !Array.isArray(d.rows) ||
      d.rows.length > 200 ||
      !Array.isArray(d.receipts) ||
      d.receipts.length > 1000 ||
      new Set(d.rows.map((r) => r.id)).size !== d.rows.length ||
      new Set(d.rows.map((r) => r.name)).size !== d.rows.length ||
      new Set(d.receipts.map((r) => r.key)).size !== d.receipts.length
    )
      throw Error("Catálogo de plantillas no válido.");
    for (const t of d.rows) {
      validateInput(t);
      if (
        !/^[a-z][a-z0-9_ñ]{2,63}$/.test(t.id) ||
        !/^[a-z][a-z0-9_ñ]{2,63}$/.test(t.name) ||
        !statuses.includes(t.status) ||
        typeof t.reason !== "string" ||
        t.reason.length > 300 ||
        (t.status === "rejected" && !t.reason.trim()) ||
        !Number.isSafeInteger(t.revision) ||
        t.revision < 1
      )
        throw Error("Estado de plantilla no válido.");
    }
    for (const r of d.receipts)
      if (
        typeof r.key !== "string" ||
        !r.key ||
        r.key.length > 120 ||
        typeof r.signature !== "string" ||
        r.signature.length > 5000 ||
        !d.rows.some((t) => t.id === r.id)
      )
        throw Error("Recibo no válido.");
    return freeze(d);
  }
  hydrate = () => {
    if (this.state.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        await this.team.hydrate();
        this.team.actor(this.actor);
        const raw = await this.io.get(this.key),
          doc = raw ? this.decode(raw) : this.state.doc;
        if (doc.revision >= this.state.doc.revision) this.patch({ doc });
        this.patch({ ready: true, error: "" });
      } catch {
        this.patch({
          ready: false,
          error: "No se pudo recuperar el catálogo de plantillas.",
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
  private check() {
    if (!this.state.ready) throw Error("Recupera primero las plantillas.");
    return this.team.actor(this.actor);
  }
  rows() {
    this.check();
    return this.state.doc.rows;
  }
  get(id: string) {
    this.check();
    const t = this.state.doc.rows.find((t) => t.id === id);
    if (!t) throw Error("Plantilla no disponible.");
    return t;
  }
  assertApproved(id: string, revision?: number) {
    const t = this.get(id);
    if (t.status !== "approved")
      throw Error("Solo puedes enviar una plantilla aprobada.");
    if (revision !== undefined && t.revision !== revision)
      throw Error("La plantilla cambió; prepara un nuevo envío.");
  }
  revision(id: string) {
    return this.get(id).revision;
  }
  render(id: string, values: readonly string[]) {
    this.assertApproved(id);
    const t = this.get(id);
    return [
      t.header === "text"
        ? t.headerText
        : t.header === "image"
          ? "[Imagen ficticia]"
          : "",
      this.preview(t, values),
      t.footer,
      t.button === "none"
        ? ""
        : t.buttonText +
          (t.button === "link" ? " · https://example.invalid/demo" : ""),
    ]
      .filter(Boolean)
      .join("\n");
  }
  preview(t: TemplateInput, values: readonly string[]) {
    validateInput(t);
    return t.body.replace(/\{\{([1-9][0-9]*)\}\}/g, (_, n: string) => {
      const v = values[Number(n) - 1]?.trim();
      if (!v || v.length > 200 || /[{}]/.test(v))
        throw Error("Completa todas las variables de la plantilla.");
      return v;
    });
  }
  private change<T>(fn: (d: Doc) => { doc: Doc; result: T }): Promise<T> {
    let q = queues.get(this.team);
    if (!q) {
      q = new Map();
      queues.set(this.team, q);
    }
    const job = (q.get(this.key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!this.adminEnabled()) throw Error("Marketing está deshabilitado.");
        if (this.check().role === "advisor")
          throw Error("Tu rol no administra plantillas.");
        const raw = await this.io.get(this.key),
          d = raw ? this.decode(raw) : this.state.doc,
          { doc, result } = fn(d),
          next = this.decode(
            JSON.stringify({ ...doc, revision: d.revision + 1 }),
          );
        await this.io.set(this.key, JSON.stringify(next));
        this.patch({ doc: next, error: "" });
        for (const p of peers.get(this.team) ?? []) {
          if (p.state.doc.revision <= next.revision) p.patch({ doc: next });
        }
        return result;
      });
    q.set(this.key, job);
    return job;
  }
  submit(
    input: TemplateInput,
    key: string,
    source?: { id: string; revision: number },
  ) {
    const value = { ...input },
      signature = JSON.stringify([this.actor, value, source ?? null]);
    return this.change((d) => {
      if (!key || key.length > 120) throw Error("Identificador no válido.");
      const prior = d.receipts.find((r) => r.key === key);
      if (prior) {
        if (prior.signature !== signature)
          throw Error("Identificador de otra operación.");
        return { doc: d, result: prior.id };
      }
      validateInput(value);
      if (!/^[a-z][a-z0-9_]{2,63}$/.test(value.name))
        throw Error("Nombre en minúsculas, números y guion bajo (3–64).");
      const old = source ? d.rows.find((t) => t.id === source.id) : undefined;
      if (
        source &&
        (!old || old.revision !== source.revision || old.status !== "rejected")
      )
        throw Error("La plantilla cambió o ya no está rechazada.");
      if (d.rows.some((t) => t.name === value.name && t.id !== old?.id))
        throw Error("Ya existe una plantilla con ese nombre.");
      if (d.receipts.length >= 1000 || (!old && d.rows.length >= 200))
        throw Error("Límite local; catálogo conservado.");
      const row: Template = {
        ...value,
        id: old?.id ?? value.name,
        status: "pending",
        reason: "",
        revision: (old?.revision ?? 0) + 1,
      };
      return {
        doc: {
          ...d,
          rows: old
            ? d.rows.map((t) => (t.id === old.id ? row : t))
            : [...d.rows, row],
          receipts: [...d.receipts, { key, signature, id: row.id }],
        },
        result: row.id,
      };
    });
  }
  review(id: string, status: TemplateStatus, reason: string, expected: number) {
    return this.change((d) => {
      const old = d.rows.find((t) => t.id === id);
      if (!old || old.revision !== expected)
        throw Error("La plantilla cambió.");
      if (
        !statuses.includes(status) ||
        (status === "paused" && old.status !== "approved") ||
        (status === "rejected" && old.status !== "pending") ||
        (status === "approved" &&
          !["pending", "paused"].includes(old.status)) ||
        status === "pending"
      )
        throw Error("Transición de revisión no válida.");
      return {
        doc: {
          ...d,
          rows: d.rows.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status,
                  reason: status === "rejected" ? reason.trim() : "",
                  revision: t.revision + 1,
                }
              : t,
          ),
        },
        result: undefined,
      };
    });
  }
}
