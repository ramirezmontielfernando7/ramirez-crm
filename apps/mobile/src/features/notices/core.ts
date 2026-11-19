import type { Actor, ConversationRepository } from "../inbox/model";
import type { StoragePort } from "../../services/storage";
import type { WorkRepository } from "../work/core";
import type { AgendaStore } from "../agenda/core";
import type { StudioStore } from "../studio/core";
export type NoticePreferences = Readonly<{
  sound: boolean;
  handoff: boolean;
  reminders: boolean;
  push: false;
}>;
export type NoticeDoc = Readonly<{
  schema: 1;
  userId: string;
  organizationId: string;
  preferences: NoticePreferences;
  read: readonly string[];
}>;
export const defaultNoticePreferences: NoticePreferences = Object.freeze({
  sound: true,
  handoff: true,
  reminders: true,
  push: false,
});
const freeze = (d: NoticeDoc): NoticeDoc =>
  Object.freeze({
    ...d,
    preferences: Object.freeze({ ...d.preferences }),
    read: Object.freeze([...d.read]),
  });
export class NoticeStore {
  readonly key: string;
  private state: Readonly<{
    ready: boolean;
    saving: boolean;
    error: string;
    doc: NoticeDoc;
  }>;
  private loading: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  constructor(
    readonly actor: Actor,
    readonly organizationId: string,
    private storage: StoragePort,
  ) {
    if (
      !/^demo-[\w-]{1,80}$/.test(actor.id) ||
      !/^demo-org-[\w-]{1,60}$/.test(organizationId) ||
      !["owner", "coordinator", "advisor"].includes(actor.role)
    )
      throw Error("Ámbito ficticio no válido.");
    this.actor = Object.freeze({ ...actor });
    this.key = `dashfort.demo.notices.v1.${organizationId}.${actor.id}`;
    this.state = Object.freeze({
      ready: false,
      saving: false,
      error: "",
      doc: freeze({
        schema: 1,
        userId: actor.id,
        organizationId,
        preferences: defaultNoticePreferences,
        read: [],
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
  hydrate = () => {
    if (this.state.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const raw = await this.storage.get(this.key);
        if (raw) {
          const d = JSON.parse(raw) as NoticeDoc;
          if (
            !d ||
            d.schema !== 1 ||
            d.userId !== this.actor.id ||
            d.organizationId !== this.organizationId ||
            !d.preferences ||
            Object.keys(d.preferences).sort().join() !==
              "handoff,push,reminders,sound" ||
            ![
              d.preferences.sound,
              d.preferences.handoff,
              d.preferences.reminders,
            ].every((v) => typeof v === "boolean") ||
            d.preferences.push !== false ||
            !Array.isArray(d.read) ||
            d.read.length > 300 ||
            !d.read.every(
              (id) =>
                typeof id === "string" &&
                /^demo-notice-[\w-]{1,1100}$/.test(id),
            ) ||
            new Set(d.read).size !== d.read.length
          )
            throw Error(
              "Preferencias locales no válidas; no se sobrescribieron.",
            );
          this.patch({ doc: freeze(d) });
        }
        this.patch({ ready: true, error: "" });
      } catch {
        this.patch({
          ready: false,
          error: "No se pudieron leer tus preferencias locales.",
        });
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  };
  private save(fn: (doc: NoticeDoc) => NoticeDoc) {
    const job = this.queue
      .catch(() => {})
      .then(async () => {
        if (!this.state.ready)
          throw Error("Recupera tus preferencias primero.");
        const next = freeze(fn(this.state.doc));
        this.patch({ saving: true, error: "" });
        try {
          await this.storage.set(this.key, JSON.stringify(next));
          this.patch({ doc: next, saving: false });
        } catch {
          this.patch({
            saving: false,
            error: "No se pudieron guardar tus preferencias locales.",
          });
          throw Error(this.state.error);
        }
      });
    this.queue = job;
    return job;
  }
  preference(key: keyof NoticePreferences, value: boolean) {
    return this.save((d) => {
      if (
        !["sound", "handoff", "reminders"].includes(key) ||
        typeof value !== "boolean"
      )
        throw Error("Push remoto permanece desactivado.");
      return { ...d, preferences: { ...d.preferences, [key]: value } };
    });
  }
  markRead(id: string) {
    return this.save((d) => {
      if (!/^demo-notice-[\w-]{1,1100}$/.test(id))
        throw Error("Aviso no válido.");
      return {
        ...d,
        read: [...d.read.filter((x) => x !== id), id].slice(-300),
      };
    });
  }
}
export type Notice = Readonly<{
  id: string;
  kind: "handoff" | "task" | "appointment" | "usage";
  title: string;
  subtitle: string;
  target: string;
}>;
export function noticeRows(
  store: NoticeStore,
  conversations: ConversationRepository,
  work: WorkRepository,
  agenda: AgendaStore,
  studio: StudioStore | null,
  now = Date.now(),
): readonly Notice[] {
  if (
    !store.snapshot().ready ||
    work.organizationId !== store.organizationId ||
    work.actor.id !== store.actor.id ||
    agenda.organizationId !== store.organizationId ||
    agenda.actor.id !== store.actor.id
  )
    return [];
  const p = store.snapshot().doc.preferences,
    rows: Notice[] = [];
  if (p.handoff)
    for (const c of conversations
      .list(store.actor)
      .filter((c) => c.ai === "pause" && !c.archived && !c.group && !c.campaign)
      .slice(0, 8))
      rows.push({
        id: `demo-notice-handoff-${c.id}`,
        kind: "handoff",
        title: `La IA pasó a ${c.name} a una persona`,
        subtitle: "Traspaso ficticio · estado actual",
        target: `/conversation/${c.id}`,
      });
  if (p.reminders && work.snapshot().ready)
    for (const t of work
      .tasks(true)
      .filter((t) => !t.done && t.due <= now + 86400000)
      .slice(0, 20))
      rows.push({
        id: `demo-notice-task-${Array.from(t.id, (c) => c.codePointAt(0)!.toString(16).padStart(6, "0")).join("")}`,
        kind: "task",
        title: `${t.due < now ? "Tarea vencida" : "Tarea por vencer"}: ${t.title}`,
        subtitle: new Date(t.due).toLocaleString("es-MX", {
          timeZone: "America/Cancun",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
        target: `/work?task=${encodeURIComponent(t.id)}`,
      });
  if (p.reminders && agenda.snapshot().ready)
    for (const a of agenda
      .snapshot()
      .rows.filter(
        (a) =>
          a.organizationId === store.organizationId &&
          (store.actor.role !== "advisor" || a.assignee === store.actor.id) &&
          a.kind === "appointment" &&
          !a.cancelled &&
          !a.lab,
      )
      .slice(0, 20)) {
      if (a.contactId) {
        try {
          conversations.get(store.actor, a.contactId);
        } catch {
          continue;
        }
      }
      rows.push({
        id: `demo-notice-appointment-${a.id}`,
        kind: "appointment",
        title: `Cita: ${a.title}`,
        subtitle: `${a.day} · ${String(Math.floor(a.start / 60)).padStart(2, "0")}:${String(a.start % 60).padStart(2, "0")} · demostración`,
        target: `/agenda?booking=${a.id}`,
      });
    }
  if (
    store.actor.role === "owner" &&
    studio?.library.snapshot().ready &&
    studio.library.organizationId === store.organizationId &&
    studio.library.actor.id === store.actor.id
  ) {
    const u = studio.usageStats();
    if (u.aiPercent >= 80)
      rows.push({
        id: `demo-notice-usage-${u.data.period.replace("-", "")}`,
        kind: "usage",
        title: `Llegaste al ${u.aiPercent} % de tu IA del mes`,
        subtitle: "Consumo ficticio",
        target: "/usage",
      });
  }
  return Object.freeze(rows.map((r) => Object.freeze(r)));
}
