import type { Actor } from "../inbox/model";
import type { StoragePort } from "../../services/storage";
import { quickReplies, CHAT_TEXT_MAX } from "../chat/model";
export type QuickReply = Readonly<{
  id: string;
  shortcut: string;
  body: string;
  revision: number;
}>;
type Doc = Readonly<{
  schema: 1;
  organizationId: string;
  sequence: number;
  rows: readonly QuickReply[];
}>;
const freeze = (d: Doc): Doc =>
  Object.freeze({
    ...d,
    rows: Object.freeze(d.rows.map((r) => Object.freeze({ ...r }))),
  });
type QuickStorage = Pick<StoragePort, "get" | "set">;
const queues = new WeakMap<QuickStorage, Map<string, Promise<unknown>>>();
export const QUICK_TEXT_MAX = Math.min(CHAT_TEXT_MAX, 4000);
export function quickProblem(shortcut: string, body: string) {
  if (!/^[a-z0-9_-]{1,30}$/.test(shortcut))
    return "Solo minúsculas, números, _ y -, hasta 30 caracteres.";
  if (!body.trim() || body.length > QUICK_TEXT_MAX)
    return `Escribe un texto de hasta ${QUICK_TEXT_MAX} caracteres.`;
  if (/[{}]/.test(body.replaceAll("{nombre}", "")))
    return "Solo se admite la variable {nombre}.";
  return "";
}
export const renderQuick = (body: string, name: string) =>
  body.replaceAll("{nombre}", () => name.trim().split(/\s+/)[0] ?? "");
export class QuickRepository {
  readonly key: string;
  readonly actor: Actor;
  private state: Readonly<{
    ready: boolean;
    saving: boolean;
    error: string;
    doc: Doc;
  }>;
  private loading: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  constructor(
    actor: Actor,
    readonly organizationId: string,
    private storage: QuickStorage,
  ) {
    if (
      !/^demo-[\w-]{1,80}$/.test(actor.id) ||
      !/^demo-org-[\w-]{1,60}$/.test(organizationId) ||
      !["owner", "coordinator", "advisor"].includes(actor.role)
    )
      throw Error("Ámbito ficticio no válido.");
    this.actor = Object.freeze({ ...actor });
    this.key = `dashfort.demo.quick.v1.${organizationId}`;
    this.state = Object.freeze({
      ready: false,
      saving: false,
      error: "",
      doc: freeze({
        schema: 1,
        organizationId,
        sequence: 0,
        rows: quickReplies.map((q) => ({
          ...q,
          id: `demo-quick-${q.shortcut}`,
          revision: 1,
        })),
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
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {}
    });
  }
  private decode(raw: string): Doc {
    if (raw.length > 1_000_000) throw Error("Catálogo demasiado grande.");
    const d = JSON.parse(raw) as Doc;
    if (
      !d ||
      d.schema !== 1 ||
      d.organizationId !== this.organizationId ||
      !Number.isSafeInteger(d.sequence) ||
      d.sequence < 0 ||
      !Array.isArray(d.rows) ||
      d.rows.length > 100 ||
      new Set(d.rows.map((r) => r.id)).size !== d.rows.length ||
      new Set(d.rows.map((r) => r.shortcut)).size !== d.rows.length
    )
      throw Error("El catálogo local no es válido.");
    for (const r of d.rows)
      if (
        !r ||
        typeof r.id !== "string" ||
        !/^demo-quick-[\w-]{1,80}$/.test(r.id) ||
        typeof r.shortcut !== "string" ||
        typeof r.body !== "string" ||
        quickProblem(r.shortcut, r.body) ||
        !Number.isSafeInteger(r.revision) ||
        r.revision < 1
      )
        throw Error("La respuesta rápida no es válida.");
    for (const row of d.rows) {
      const seq = /^demo-quick-local-(\d+)$/.exec(row.id);
      if (seq && Number(seq[1]) > d.sequence)
        throw Error("Secuencia local no válida.");
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
          error: "No se pudieron leer las respuestas rápidas locales.",
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
  save(input: {
    id: string | null;
    shortcut: string;
    body: string;
    expected: number | null;
  }) {
    if (this.actor.role === "advisor")
      return Promise.reject(
        Error("Tu perfil no puede administrar respuestas rápidas."),
      );
    const value = Object.freeze({ ...input });
    let map = queues.get(this.storage);
    if (!map) {
      map = new Map();
      queues.set(this.storage, map);
    }
    const job = (map.get(this.key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!this.state.ready)
          throw Error("Recupera el catálogo antes de guardar.");
        const problem = quickProblem(value.shortcut, value.body);
        if (problem) throw Error(problem);
        this.patch({ saving: true, error: "" });
        try {
          const raw = await this.storage.get(this.key),
            d = raw ? this.decode(raw) : this.state.doc,
            old = value.id ? d.rows.find((r) => r.id === value.id) : null;
          if (value.id && (!old || old.revision !== value.expected))
            throw Error(
              "La respuesta cambió. Recarga el catálogo antes de editar.",
            );
          if (!value.id && value.expected !== null)
            throw Error("La revisión de la nueva respuesta no es válida.");
          if (
            d.rows.some(
              (r) => r.id !== value.id && r.shortcut === value.shortcut,
            )
          )
            throw Error("Ese atajo ya existe en esta organización.");
          if (!old && d.rows.length >= 100)
            throw Error("La demostración admite hasta 100 respuestas rápidas.");
          const sequence = d.sequence + 1,
            row = {
              id: old?.id ?? `demo-quick-local-${sequence}`,
              shortcut: value.shortcut,
              body: value.body,
              revision: (old?.revision ?? 0) + 1,
            };
          const next = freeze({
            ...d,
            sequence,
            rows: old
              ? d.rows.map((r) => (r.id === old.id ? row : r))
              : [...d.rows, row],
          });
          await this.storage.set(this.key, JSON.stringify(next));
          this.patch({ doc: next, saving: false });
          return row.id;
        } catch (e) {
          this.patch({
            saving: false,
            error:
              e instanceof Error
                ? e.message
                : "No se pudo guardar la respuesta local.",
          });
          throw Error(this.state.error);
        }
      });
    map.set(this.key, job);
    return job;
  }
}
