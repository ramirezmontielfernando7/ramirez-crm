import type { Actor } from "../inbox/model";
import type { StoragePort } from "../../services/storage";
export const businessHours = Object.freeze([
  Object.freeze({
    label: "Lunes a viernes",
    value: "9:00 – 19:00",
    start: 540,
    end: 1140,
  }),
  Object.freeze({
    label: "Sábado",
    value: "10:00 – 14:00",
    start: 600,
    end: 840,
  }),
  Object.freeze({ label: "Domingo", value: "Cerrado", start: 0, end: 0 }),
]);
export function withinBusinessHours(
  day: string,
  start: number,
  duration: number,
) {
  const date = new Date(`${day}T12:00:00Z`),
    weekday = date.getUTCDay();
  if (
    !Number.isFinite(date.getTime()) ||
    !Number.isInteger(start) ||
    !Number.isInteger(duration) ||
    duration <= 0
  )
    return false;
  const h = businessHours[weekday === 0 ? 2 : weekday === 6 ? 1 : 0]!;
  return start >= h.start && start + duration <= h.end;
}
export type Provider = "zoom" | "meet";
type Doc = Readonly<{
  schema: 1;
  organizationId: string;
  revision: number;
  enabled: Readonly<{ zoom: boolean; meet: boolean }>;
  receipts: readonly { key: string; provider: Provider; enabled: boolean }[];
}>;
type IO = Pick<StoragePort, "get" | "set">;
const queues = new WeakMap<IO, Map<string, Promise<unknown>>>();
const freeze = (d: Doc): Doc =>
  Object.freeze({
    ...d,
    enabled: Object.freeze({ ...d.enabled }),
    receipts: Object.freeze(d.receipts.map((r) => Object.freeze({ ...r }))),
  });
export class CalendarConnectors {
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
    private storage: IO,
  ) {
    if (
      !/^demo-[\w-]{1,80}$/.test(actor.id) ||
      !/^demo-org-[\w-]{1,60}$/.test(organizationId) ||
      !["owner", "coordinator", "advisor"].includes(actor.role)
    )
      throw Error("Ámbito ficticio no válido.");
    this.actor = Object.freeze({ ...actor });
    this.key = `dashfort.demo.calendar-connectors.v1.${organizationId}`;
    this.state = Object.freeze({
      ready: false,
      saving: false,
      error: "",
      doc: freeze({
        schema: 1,
        organizationId,
        revision: 0,
        enabled: { zoom: true, meet: false },
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
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {}
    });
  }
  private decode(raw: string) {
    if (raw.length > 100000) throw Error("Conectores locales no válidos.");
    const d = JSON.parse(raw) as Doc;
    if (
      !d ||
      d.schema !== 1 ||
      d.organizationId !== this.organizationId ||
      !Number.isSafeInteger(d.revision) ||
      d.revision < 0 ||
      !d.enabled ||
      typeof d.enabled.zoom !== "boolean" ||
      typeof d.enabled.meet !== "boolean" ||
      Object.keys(d.enabled).sort().join() !== "meet,zoom" ||
      !Array.isArray(d.receipts) ||
      d.receipts.length > 40 ||
      new Set(d.receipts.map((r) => r.key)).size !== d.receipts.length
    )
      throw Error("Conectores locales no válidos.");
    for (const r of d.receipts)
      if (
        !r ||
        typeof r.key !== "string" ||
        !r.key ||
        r.key.length > 160 ||
        !["zoom", "meet"].includes(r.provider) ||
        typeof r.enabled !== "boolean"
      )
        throw Error("Recibo de conector no válido.");
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
          error: "No se pudieron leer los conectores de demostración.",
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
  joinable(modality: string) {
    return (
      this.state.ready &&
      (modality === "Zoom"
        ? this.state.doc.enabled.zoom
        : modality === "Meet"
          ? this.state.doc.enabled.meet
          : false)
    );
  }
  set(provider: Provider, enabled: boolean, expected: number, key: string) {
    if (this.actor.role === "advisor")
      return Promise.reject(Error("Tu perfil no puede gestionar conectores."));
    if (
      !["zoom", "meet"].includes(provider) ||
      typeof enabled !== "boolean" ||
      !key ||
      key.length > 160
    )
      return Promise.reject(Error("Cambio de conector no válido."));
    let map = queues.get(this.storage);
    if (!map) {
      map = new Map();
      queues.set(this.storage, map);
    }
    const job = (map.get(this.key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!this.state.ready)
          throw Error("Recupera los conectores antes de cambiar.");
        this.patch({ saving: true, error: "" });
        try {
          const raw = await this.storage.get(this.key),
            d = raw ? this.decode(raw) : this.state.doc,
            receipt = d.receipts.find((r) => r.key === key);
          if (receipt) {
            if (receipt.provider !== provider || receipt.enabled !== enabled)
              throw Error("Identificador de otra operación.");
            this.patch({ doc: d, saving: false });
            return;
          }
          if (d.revision !== expected)
            throw Error("El conector cambió. Recarga antes de editar.");
          const next = freeze({
            ...d,
            revision: d.revision + 1,
            enabled: { ...d.enabled, [provider]: enabled },
            receipts: [...d.receipts, { key, provider, enabled }].slice(-40),
          });
          await this.storage.set(this.key, JSON.stringify(next));
          this.patch({ doc: next, saving: false });
        } catch (e) {
          this.patch({
            saving: false,
            error:
              e instanceof Error
                ? e.message
                : "No se pudo guardar el conector local.",
          });
          throw Error(this.state.error);
        }
      });
    map.set(this.key, job);
    return job;
  }
}
