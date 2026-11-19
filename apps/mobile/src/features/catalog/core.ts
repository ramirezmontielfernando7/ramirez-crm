import type { Actor } from "../inbox/model";
import type { StoragePort } from "../../services/storage";
export const tagPalette = [
  "#8a8f98",
  "#4338ca",
  "#1fb35b",
  "#f59e0b",
  "#d94a4a",
  "#8b5cf6",
] as const;
export const initialTags = [
  "Promo nov",
  "Mayoreo",
  "Facebook Ads",
  "VIP",
  "Urgente",
  "Seguimiento",
  "Referido",
] as const;
export const initialReasons = [
  "Precio",
  "Sin respuesta",
  "Compró con otro",
  "Ya no lo necesita",
  "Fuera de zona",
  "Otro",
] as const;
export const importTag = "Importación · demo";
export type CatalogTag = Readonly<{
  id: string;
  name: string;
  aliases: readonly string[];
  color: string;
  automatic: boolean;
  active: boolean;
  redirect: string | null;
  revision: number;
}>;
export type LossReason = Readonly<{
  id: string;
  name: string;
  aliases: readonly string[];
  active: boolean;
  fixed: boolean;
  revision: number;
}>;
export type CatalogDoc = Readonly<{
  schema: 1;
  organizationId: string;
  sequence: number;
  tags: readonly CatalogTag[];
  reasons: readonly LossReason[];
  receipts: readonly { key: string; signature: string; result: string }[];
}>;
type IO = Pick<StoragePort, "get" | "set">;
const queues = new WeakMap<IO, Map<string, Promise<unknown>>>();
const norm = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .trim()
    .replace(/\s+/g, " ");
const freeze = (d: CatalogDoc): CatalogDoc =>
  Object.freeze({
    ...d,
    tags: Object.freeze(
      d.tags.map((t) =>
        Object.freeze({ ...t, aliases: Object.freeze([...t.aliases]) }),
      ),
    ),
    reasons: Object.freeze(
      d.reasons.map((r) =>
        Object.freeze({ ...r, aliases: Object.freeze([...r.aliases]) }),
      ),
    ),
    receipts: Object.freeze(d.receipts.map((r) => Object.freeze({ ...r }))),
  });
function seed(organizationId: string): CatalogDoc {
  return freeze({
    schema: 1,
    organizationId,
    sequence: 0,
    tags: [
      ...initialTags.map((name, i) => ({
        id: `demo-tag-${i + 1}`,
        name,
        aliases: [],
        color: "#4338ca",
        automatic: false,
        active: true,
        redirect: null,
        revision: 1,
      })),
      {
        id: "demo-tag-import",
        name: importTag,
        aliases: [],
        color: "#8a8f98",
        automatic: true,
        active: true,
        redirect: null,
        revision: 1,
      },
    ],
    reasons: initialReasons.map((name, i) => ({
      id: `demo-reason-${i + 1}`,
      name,
      aliases: [],
      active: true,
      fixed: name === "Otro",
      revision: 1,
    })),
    receipts: [],
  });
}
let ops = 0;
export const catalogKey = () =>
  `demo-catalog-${Date.now().toString(36)}-${++ops}`;
export class CatalogStore {
  readonly actor: Actor;
  readonly key: string;
  private state: Readonly<{
    ready: boolean;
    saving: boolean;
    error: string;
    doc: CatalogDoc;
  }>;
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private localQueue: Promise<unknown> = Promise.resolve();
  constructor(
    actor: Actor,
    readonly organizationId = "demo-org-cristal",
    private storage?: IO,
  ) {
    if (
      !/^demo-[\w-]{1,80}$/.test(actor.id) ||
      !/^demo-org-[\w-]{1,60}$/.test(organizationId) ||
      !["owner", "coordinator", "advisor"].includes(actor.role)
    )
      throw Error("Ámbito ficticio no válido.");
    this.actor = Object.freeze({ ...actor });
    this.key = `dashfort.demo.catalog.v1.${organizationId}`;
    this.state = Object.freeze({
      ready: !storage,
      saving: false,
      error: "",
      doc: seed(organizationId),
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
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {}
    });
  }
  private validate(raw: string) {
    if (raw.length > 1_500_000) throw Error("Catálogo demasiado grande.");
    const d = JSON.parse(raw) as CatalogDoc;
    const text = (v: unknown) =>
      typeof v === "string" && v.trim().length > 0 && v.length <= 60;
    if (
      !d ||
      d.schema !== 1 ||
      d.organizationId !== this.organizationId ||
      !Number.isSafeInteger(d.sequence) ||
      d.sequence < 0 ||
      !Array.isArray(d.tags) ||
      !Array.isArray(d.reasons) ||
      d.tags.length > 100 ||
      d.reasons.length > 100 ||
      !Array.isArray(d.receipts) ||
      d.receipts.length > 256
    )
      throw Error("Catálogo local no válido.");
    for (const [rows, prefix] of [
      [d.tags, "tag"],
      [d.reasons, "reason"],
    ] as const) {
      const names = new Map<string, string>(),
        ids = new Set<string>();
      for (const row of rows) {
        if (
          !row ||
          typeof row.id !== "string" ||
          !new RegExp(`^demo-${prefix}-[\\w-]{1,80}$`).test(row.id) ||
          ids.has(row.id) ||
          !text(row.name) ||
          !Array.isArray(row.aliases) ||
          row.aliases.length > 100 ||
          !row.aliases.every(text) ||
          typeof row.active !== "boolean" ||
          !Number.isSafeInteger(row.revision) ||
          row.revision < 1
        )
          throw Error("Fila de catálogo no válida.");
        ids.add(row.id);
        for (const n of [row.name, ...row.aliases]) {
          const key = norm(n);
          if (names.has(key) && names.get(key) !== row.id)
            throw Error("Nombres de catálogo duplicados.");
          names.set(key, row.id);
        }
        const seq = new RegExp(`^demo-${prefix}-local-(\\d+)$`).exec(row.id);
        if (seq && Number(seq[1]) > d.sequence)
          throw Error("Secuencia de catálogo no válida.");
      }
    }
    for (const t of d.tags) {
      if (
        !(tagPalette as readonly string[]).includes(t.color) ||
        typeof t.automatic !== "boolean" ||
        !(t.redirect === null || typeof t.redirect === "string") ||
        (t.active && t.redirect)
      )
        throw Error("Etiqueta local no válida.");
      let seen = new Set([t.id]),
        next = t.redirect;
      while (next) {
        if (seen.has(next)) throw Error("Fusión circular no válida.");
        seen.add(next);
        const dest = d.tags.find((x) => x.id === next);
        if (!dest || dest.automatic)
          throw Error("Destino de fusión no válido.");
        next = dest.redirect;
      }
    }
    const originalImport = d.tags.find((t) => t.id === "demo-tag-import");
    if (
      !originalImport ||
      !originalImport.automatic ||
      originalImport.name !== importTag ||
      originalImport.aliases.length ||
      d.tags.some((t) => t.automatic && t.id !== "demo-tag-import")
    )
      throw Error("Etiqueta automática no válida.");
    const other = d.reasons.find((r) => r.id === "demo-reason-6");
    if (
      !other ||
      other.name !== "Otro" ||
      !other.fixed ||
      !other.active ||
      other.aliases.length ||
      d.reasons.some(
        (r) => typeof r.fixed !== "boolean" || (r.fixed && r.id !== other.id),
      )
    )
      throw Error("El motivo Otro debe conservarse.");
    const keys = new Set();
    for (const r of d.receipts) {
      if (
        !r ||
        typeof r.key !== "string" ||
        !r.key ||
        r.key.length > 160 ||
        keys.has(r.key) ||
        typeof r.signature !== "string" ||
        r.signature.length > 4000 ||
        typeof r.result !== "string"
      )
        throw Error("Recibo de catálogo no válido.");
      keys.add(r.key);
    }
    return freeze(d);
  }
  hydrate = () => {
    if (this.state.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const raw = await this.storage?.get(this.key);
        if (raw) this.patch({ doc: this.validate(raw) });
        this.patch({ ready: true, error: "" });
      } catch {
        this.patch({
          ready: false,
          error: "No se pudo recuperar el catálogo local. No se sobrescribió.",
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
  tagNames(includeAutomatic = false) {
    return this.state.doc.tags
      .filter((t) => t.active && (includeAutomatic || !t.automatic))
      .map((t) => t.name);
  }
  knownTag(name: string) {
    return this.state.doc.tags.some(
      (t) => t.name === name || t.aliases.includes(name),
    );
  }
  tag(name: string) {
    let t = this.state.doc.tags.find(
      (t) => t.name === name || t.aliases.includes(name),
    );
    const seen = new Set<string>();
    while (t?.redirect) {
      if (seen.has(t.id)) return null;
      seen.add(t.id);
      t = this.state.doc.tags.find((x) => x.id === t!.redirect);
    }
    return t?.active ? t : null;
  }
  normalizeTags(names: readonly string[]) {
    return [
      ...new Set(
        names.map((n) => this.tag(n)?.name).filter((n): n is string => !!n),
      ),
    ];
  }
  reasonNames() {
    return this.state.doc.reasons.filter((r) => r.active).map((r) => r.name);
  }
  knownReason(name: string) {
    return this.state.doc.reasons.some(
      (r) => r.name === name || r.aliases.includes(name),
    );
  }
  private name(
    name: string,
    rows: readonly { id: string; name: string; aliases: readonly string[] }[],
    id: string | null,
  ) {
    const v = name.trim().replace(/\s+/g, " ");
    if (!v || v.length > 60)
      throw Error("Escribe un nombre de hasta 60 caracteres.");
    if (
      rows.some(
        (r) =>
          r.id !== id &&
          [r.name, ...r.aliases].some((n) => norm(n) === norm(v)),
      )
    )
      throw Error("Ese nombre ya pertenece a un registro actual o histórico.");
    return v;
  }
  private mutate(
    key: string,
    signature: unknown,
    fn: (d: CatalogDoc) => { doc: CatalogDoc; result: string },
  ) {
    if (this.actor.role === "advisor")
      return Promise.reject(Error("Tu perfil no puede gestionar catálogos."));
    if (!key || key.length > 160)
      return Promise.reject(Error("Identificador no válido."));
    const sig = JSON.stringify(signature);
    let map = this.storage ? queues.get(this.storage) : null;
    if (this.storage && !map) {
      map = new Map();
      queues.set(this.storage, map);
    }
    const job = (map?.get(this.key) ?? this.localQueue)
      .catch(() => {})
      .then(async () => {
        if (!this.state.ready)
          throw Error("Recupera el catálogo antes de guardar.");
        this.patch({ saving: true, error: "" });
        try {
          const raw = await this.storage?.get(this.key),
            d = raw ? this.validate(raw) : this.state.doc,
            receipt = d.receipts.find((r) => r.key === key);
          if (receipt) {
            if (receipt.signature !== sig)
              throw Error("Este identificador corresponde a otra operación.");
            this.patch({ doc: d, saving: false });
            return receipt.result;
          }
          const result = fn({ ...d, sequence: d.sequence + 1 });
          const next = this.validate(
            JSON.stringify({
              ...result.doc,
              receipts: [
                ...d.receipts,
                { key, signature: sig, result: result.result },
              ].slice(-256),
            }),
          );
          await this.storage?.set(this.key, JSON.stringify(next));
          this.patch({ doc: next, saving: false });
          return result.result;
        } catch (e) {
          this.patch({
            saving: false,
            error:
              e instanceof Error
                ? e.message
                : "No se pudo guardar el catálogo local.",
          });
          throw Error(this.state.error);
        }
      });
    this.localQueue = job;
    map?.set(this.key, job);
    return job;
  }
  saveTag(
    input: {
      id: string | null;
      name: string;
      color: string;
      expected: number | null;
    },
    key = catalogKey(),
  ) {
    const v = Object.freeze({ ...input });
    return this.mutate(key, ["tag", v], (d) => {
      const old = v.id ? d.tags.find((t) => t.id === v.id) : null;
      if (
        v.id &&
        (!old || old.revision !== v.expected || !old.active || old.automatic)
      )
        throw Error("La etiqueta cambió. Recarga antes de editar.");
      if (!(tagPalette as readonly string[]).includes(v.color))
        throw Error("Elige un color de la paleta.");
      if (!old && d.tags.length >= 100)
        throw Error("La demo admite hasta 100 etiquetas históricas.");
      const name = this.name(v.name, d.tags, v.id),
        row = {
          id: old?.id ?? `demo-tag-local-${d.sequence}`,
          name,
          color: v.color,
          aliases: old
            ? [
                ...new Set([
                  ...old.aliases,
                  ...(old.name !== name ? [old.name] : []),
                ]),
              ].filter((n) => n !== name)
            : [],
          active: true,
          automatic: false,
          redirect: null,
          revision: (old?.revision ?? 0) + 1,
        };
      return {
        doc: {
          ...d,
          tags: old
            ? d.tags.map((t) => (t.id === old.id ? row : t))
            : [...d.tags, row],
        },
        result: row.id,
      };
    });
  }
  removeTag(id: string, expected: number, key = catalogKey()) {
    return this.mutate(key, ["remove-tag", id, expected], (d) => {
      const t = d.tags.find((t) => t.id === id);
      if (!t || !t.active || t.automatic || t.revision !== expected)
        throw Error("La etiqueta cambió o es de sistema.");
      return {
        doc: {
          ...d,
          tags: d.tags.map((t) =>
            t.id === id ? { ...t, active: false, revision: t.revision + 1 } : t,
          ),
        },
        result: id,
      };
    });
  }
  mergeTag(
    source: string,
    target: string,
    expected: number,
    targetRevision: number,
    key = catalogKey(),
  ) {
    return this.mutate(
      key,
      ["merge", source, target, expected, targetRevision],
      (d) => {
        const from = d.tags.find((t) => t.id === source),
          to = d.tags.find((t) => t.id === target);
        if (
          !from?.active ||
          !to?.active ||
          to.automatic ||
          source === target ||
          from.revision !== expected ||
          to.revision !== targetRevision
        )
          throw Error("La fusión cambió. Revisa sus etiquetas.");
        return {
          doc: {
            ...d,
            tags: d.tags.map((t) =>
              t.id === source
                ? {
                    ...t,
                    active: false,
                    redirect: target,
                    revision: t.revision + 1,
                  }
                : t,
            ),
          },
          result: target,
        };
      },
    );
  }
  saveReason(
    input: { id: string | null; name: string; expected: number | null },
    key = catalogKey(),
  ) {
    const v = Object.freeze({ ...input });
    return this.mutate(key, ["reason", v], (d) => {
      const old = v.id ? d.reasons.find((r) => r.id === v.id) : null;
      if (
        v.id &&
        (!old || old.fixed || !old.active || old.revision !== v.expected)
      )
        throw Error("El motivo cambió o es fijo.");
      if (!old && d.reasons.length >= 100)
        throw Error("La demo admite hasta 100 motivos históricos.");
      const name = this.name(v.name, d.reasons, v.id),
        row = {
          id: old?.id ?? `demo-reason-local-${d.sequence}`,
          name,
          aliases: old
            ? [
                ...new Set([
                  ...old.aliases,
                  ...(old.name !== name ? [old.name] : []),
                ]),
              ].filter((n) => n !== name)
            : [],
          active: true,
          fixed: false,
          revision: (old?.revision ?? 0) + 1,
        };
      return {
        doc: {
          ...d,
          reasons: old
            ? d.reasons.map((r) => (r.id === old.id ? row : r))
            : [...d.reasons, row],
        },
        result: row.id,
      };
    });
  }
  deactivateReason(id: string, expected: number, key = catalogKey()) {
    return this.mutate(key, ["deactivate-reason", id, expected], (d) => {
      const r = d.reasons.find((r) => r.id === id);
      if (!r?.active || r.fixed || r.revision !== expected)
        throw Error("El motivo cambió o es fijo.");
      return {
        doc: {
          ...d,
          reasons: d.reasons.map((r) =>
            r.id === id ? { ...r, active: false, revision: r.revision + 1 } : r,
          ),
        },
        result: id,
      };
    });
  }
}
