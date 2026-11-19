import type { Actor } from "../inbox/model";
import type { StoragePort } from "../../services/storage";
export const agendaTeam = [
  "demo-owner",
  "demo-coordinator",
  "demo-advisor",
] as const;
export type Appointment = Readonly<{
  id: string;
  organizationId: string;
  assignee: string;
  day: string;
  start: number;
  duration: number;
  title: string;
  who: string;
  modality: "Presencial" | "Meet" | "Zoom" | "";
  notes: string;
  kind: "appointment" | "block";
  cancelled: boolean;
  lab: boolean;
  version: number;
}>;
type Status = "normal" | "loading" | "empty" | "offline" | "error";
export type AgendaState = Readonly<{
  ready: boolean;
  saving: boolean;
  error: string;
  rows: readonly Appointment[];
  day: string;
  view: "day" | "month";
  showCancelled: boolean;
  showLab: boolean;
  status: Status;
}>;
export function dateParts(day: string) {
  const m = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw Error("La fecha no es válida.");
  const year = +m[1]!,
    month = +m[2]!,
    date = +m[3]!;
  const d = new Date(Date.UTC(year, month - 1, date));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== date
  )
    throw Error("La fecha no es válida.");
  return { year, month, date, value: d };
}
export const addDays = (day: string, count: number) => {
  const { value } = dateParts(day);
  value.setUTCDate(value.getUTCDate() + count);
  const next = value.toISOString().slice(0, 10);
  dateParts(next);
  return next;
};
export const timeLabel = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
export function weekDays(day: string) {
  const weekday = (dateParts(day).value.getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => {
    try {
      return addDays(day, i - weekday);
    } catch {
      return null;
    }
  }).filter((d): d is string => d !== null);
}
export const dayLabel = (day: string) =>
  dateParts(day).value.toLocaleDateString("es-MX", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
export function calendarCells(year: number, month: number) {
  dateParts(`${year}-${String(month).padStart(2, "0")}-01`);
  const first = new Date(Date.UTC(year, month - 1, 1)),
    offset = (first.getUTCDay() + 6) % 7,
    count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, i) =>
    i >= offset && i < offset + count
      ? `${year}-${String(month).padStart(2, "0")}-${String(i - offset + 1).padStart(2, "0")}`
      : null,
  );
}
function seeds(organizationId: string): readonly Appointment[] {
  const rows: Omit<
    Appointment,
    "organizationId" | "version" | "cancelled" | "lab" | "notes"
  >[] = [
    {
      id: "demo-booking-b1",
      day: "2026-11-12",
      start: 600,
      duration: 45,
      title: "Visita a sucursal",
      who: "Luis Ramírez",
      assignee: "demo-advisor",
      kind: "appointment",
      modality: "Presencial",
    },
    {
      id: "demo-booking-b2",
      day: "2026-11-12",
      start: 690,
      duration: 45,
      title: "Videollamada · maestría",
      who: "Unid Campus",
      assignee: "demo-coordinator",
      kind: "appointment",
      modality: "Meet",
    },
    {
      id: "demo-booking-b3",
      day: "2026-11-12",
      start: 780,
      duration: 60,
      title: "Comida con proveedor",
      who: "Bloqueo",
      assignee: "demo-owner",
      kind: "block",
      modality: "",
    },
    {
      id: "demo-booking-b4",
      day: "2026-11-12",
      start: 990,
      duration: 45,
      title: "Demostración del plan Pro",
      who: "Karla Méndez",
      assignee: "demo-owner",
      kind: "appointment",
      modality: "Zoom",
    },
  ];
  return Object.freeze([
    ...rows.map((r) =>
      Object.freeze({
        ...r,
        organizationId,
        version: 1,
        cancelled: false,
        lab: false,
        notes: r.id.endsWith("b4") ? "Quiere conocer el plan Pro" : "",
      }),
    ),
    Object.freeze({
      ...rows[0]!,
      id: "demo-booking-lab",
      day: "2026-11-11",
      organizationId,
      version: 1,
      cancelled: false,
      lab: true,
      notes: "Prueba ficticia del Laboratorio",
    }),
    Object.freeze({
      ...rows[0]!,
      id: "demo-booking-cancelled",
      start: 840,
      organizationId,
      version: 1,
      cancelled: true,
      lab: false,
      notes: "Cita de muestra cancelada",
    }),
  ]);
}
export class AgendaStore {
  readonly actor: Readonly<Actor>;
  readonly key: string;
  private state: AgendaState;
  private listeners = new Set<() => void>();
  private offsets = new Map<string, number>();
  private restore: Promise<void> | null = null;
  private sequence = 0;
  constructor(
    actor: Actor,
    readonly organizationId: string,
    private storage: StoragePort,
    private now = Date.now,
  ) {
    if (
      !/^demo-org-[\w-]{1,60}$/.test(organizationId) ||
      !/^demo-[\w-]{1,80}$/.test(actor.id) ||
      !["owner", "coordinator", "advisor"].includes(actor.role)
    )
      throw Error("Scope ficticio inválido.");
    this.actor = Object.freeze({ ...actor });
    this.key = `dashfort:agenda:v1:${organizationId}:${actor.id}`;
    this.state = Object.freeze({
      ready: false,
      saving: false,
      error: "",
      rows: seeds(organizationId),
      day: "2026-11-12",
      view: "day",
      showCancelled: false,
      showLab: false,
      status: "normal",
    });
  }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private patch(p: Partial<AgendaState>) {
    this.state = Object.freeze({ ...this.state, ...p });
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        /* An observer cannot interrupt persistence. */
      }
    });
  }
  configure(
    p: Partial<
      Pick<AgendaState, "showCancelled" | "showLab" | "status" | "view">
    >,
  ) {
    this.patch(p);
  }
  selectDay(day: string) {
    dateParts(day);
    this.patch({ day, view: "day" });
  }
  setMonth(year: number, month: number) {
    calendarCells(year, month);
    this.patch({
      day: `${year}-${String(month).padStart(2, "0")}-01`,
      view: "month",
    });
  }
  rememberOffset(day: string, y: number) {
    if (Number.isFinite(y) && y >= 0 && y < 100000) this.offsets.set(day, y);
  }
  offset(day: string) {
    return this.offsets.get(day) ?? 0;
  }
  private permitted(r: Appointment) {
    return (
      r.organizationId === this.organizationId &&
      (this.actor.role !== "advisor" || r.assignee === this.actor.id)
    );
  }
  get(id: string) {
    const r = this.state.rows.find((r) => r.id === id && this.permitted(r));
    if (!r) throw Error("Tu perfil no tiene acceso a esta cita.");
    return r;
  }
  list(day = this.state.day) {
    dateParts(day);
    return this.state.status === "empty"
      ? []
      : this.state.rows
          .filter(
            (r) =>
              this.permitted(r) &&
              r.day === day &&
              (this.state.showCancelled || !r.cancelled) &&
              (this.state.showLab || !r.lab),
          )
          .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  }
  hasAppointments(day: string) {
    return this.list(day).some((r) => !r.cancelled);
  }
  private validate(r: Appointment) {
    dateParts(r.day);
    if (
      !/^demo-booking-[\w-]{1,100}$/.test(r.id) ||
      r.organizationId !== this.organizationId ||
      !(agendaTeam as readonly string[]).includes(r.assignee) ||
      !Number.isSafeInteger(r.start) ||
      r.start < 480 ||
      r.start % 15 !== 0 ||
      ![30, 45, 60, 120].includes(r.duration) ||
      r.start + r.duration > 1200 ||
      typeof r.title !== "string" ||
      !r.title.trim() ||
      r.title.length > 180 ||
      typeof r.who !== "string" ||
      r.who.length > 180 ||
      typeof r.notes !== "string" ||
      r.notes.length > 2000 ||
      !["appointment", "block"].includes(r.kind) ||
      !["Presencial", "Meet", "Zoom", ""].includes(r.modality) ||
      typeof r.cancelled !== "boolean" ||
      typeof r.lab !== "boolean" ||
      !Number.isSafeInteger(r.version) ||
      r.version < 1
    )
      throw Error("Los datos de la cita no son válidos.");
  }
  hydrate = (): Promise<void> => {
    if (this.restore) return this.restore;
    if (this.state.ready && !this.state.error) return Promise.resolve();
    this.restore = Promise.resolve().then(async () => {
      try {
        const raw = await this.storage.get(this.key);
        let rows = this.state.rows;
        if (raw !== null) {
          if (raw.length > 5_000_000)
            throw Error("La Agenda local supera el límite de lectura.");
          const d = JSON.parse(raw);
          if (
            d.schema !== 1 ||
            d.organizationId !== this.organizationId ||
            d.userId !== this.actor.id ||
            !Array.isArray(d.rows) ||
            d.rows.length > 5000 ||
            d.rows.some((r: unknown) => !r || typeof r !== "object") ||
            new Set(d.rows.map((r: Appointment) => r.id)).size !== d.rows.length
          )
            throw Error("La Agenda local no es válida; no se sobrescribió.");
          d.rows.forEach((r: Appointment) => this.validate(r));
          const active = [...d.rows]
            .filter((r: Appointment) => !r.cancelled)
            .sort(
              (a: Appointment, b: Appointment) =>
                a.assignee.localeCompare(b.assignee) ||
                a.day.localeCompare(b.day) ||
                a.start - b.start,
            );
          for (let i = 1; i < active.length; i++) {
            const prev = active[i - 1] as Appointment,
              current = active[i] as Appointment;
            if (
              prev.assignee === current.assignee &&
              prev.day === current.day &&
              current.start < prev.start + prev.duration
            )
              throw Error(
                "La Agenda local contiene horarios superpuestos; no se sobrescribió.",
              );
          }
          rows = Object.freeze(
            d.rows.map((r: Appointment) => Object.freeze({ ...r })),
          );
        }
        this.patch({ rows, ready: true, status: "normal", error: "" });
      } catch (e) {
        this.patch({
          ready: false,
          status: "error",
          error:
            e instanceof Error ? e.message : "No se pudo leer la Agenda local.",
        });
      } finally {
        this.restore = null;
      }
    });
    this.patch({ status: "loading", error: "" });
    return this.restore;
  };
  private free(row: Appointment, exclude: string | null = null) {
    return !this.state.rows.some(
      (r) =>
        r.id !== exclude &&
        !r.cancelled &&
        r.assignee === row.assignee &&
        r.day === row.day &&
        r.start < row.start + row.duration &&
        row.start < r.start + r.duration,
    );
  }
  blockSlots(day: string, duration: number, exclude: string | null = null) {
    dateParts(day);
    const assignee = exclude ? this.get(exclude).assignee : this.actor.id;
    return Array.from({ length: 24 }, (_, i) => 480 + i * 30).filter(
      (start) =>
        start + duration <= 1200 &&
        this.free(
          {
            id: "demo-booking-probe",
            organizationId: this.organizationId,
            assignee,
            day,
            start,
            duration,
            title: "Bloqueo",
            who: "Bloqueo",
            modality: "",
            kind: "block",
            cancelled: false,
            lab: false,
            version: 1,
            notes: "",
          },
          exclude,
        ),
    );
  }
  available(id: string, day: string) {
    const old = this.get(id);
    dateParts(day);
    if (old.cancelled) return [];
    return [540, 630, 720, 1020].filter((start) =>
      this.free({ ...old, day, start }, old.id),
    );
  }
  availableDays(id: string) {
    return ["2026-11-10", "2026-11-11", "2026-11-13"].filter(
      (day) => this.available(id, day).length > 0,
    );
  }
  private async persist(
    rows: readonly Appointment[],
    navigation: Partial<Pick<AgendaState, "day" | "view">> = {},
  ) {
    if (!this.state.ready || this.state.saving)
      throw Error(
        "Espera a que termine la operación local o reintenta la lectura.",
      );
    const raw = JSON.stringify({
      schema: 1,
      organizationId: this.organizationId,
      userId: this.actor.id,
      rows,
    });
    if (raw.length > 5_000_000)
      throw Error("La Agenda local alcanzó su límite de demostración.");
    this.patch({ saving: true, error: "" });
    try {
      await this.storage.set(this.key, raw);
      this.patch({
        rows: Object.freeze([...rows]),
        saving: false,
        error: "",
        ...navigation,
      });
    } catch {
      this.patch({
        saving: false,
        error:
          "No se pudo guardar localmente. Conserva los cambios y reintenta.",
      });
      throw Error(this.state.error);
    }
  }
  async block(
    day: string,
    start: number,
    duration: number,
    reason: string,
    id?: string,
    version?: number,
  ) {
    const old = id ? this.get(id) : null;
    if (
      old &&
      (old.kind !== "block" || old.version !== version || old.cancelled)
    )
      throw Error("El bloqueo cambió. Vuelve a abrirlo.");
    if (!old && this.state.rows.length >= 5000)
      throw Error("La Agenda de demostración alcanzó su límite.");
    const used = new Set(this.state.rows.map((r) => r.id));
    let key = old?.id ?? "";
    if (!old)
      do {
        key = `demo-booking-local-${this.now().toString(36)}-${++this.sequence}`;
      } while (used.has(key));
    const row: Appointment = Object.freeze({
      id: key,
      organizationId: this.organizationId,
      assignee: old?.assignee ?? this.actor.id,
      day,
      start,
      duration,
      title: reason.trim() || "Horario bloqueado",
      who: "Bloqueo",
      notes: "",
      kind: "block",
      modality: "",
      cancelled: false,
      lab: false,
      version: (old?.version ?? 0) + 1,
    });
    this.validate(row);
    if (!this.free(row, old?.id)) throw Error("Ese horario ya está ocupado.");
    await this.persist(
      old
        ? this.state.rows.map((r) => (r.id === key ? row : r))
        : [...this.state.rows, row],
      { day, view: "day" },
    );
    return key;
  }
  async move(id: string, version: number, day: string, start: number) {
    const old = this.get(id);
    if (old.version !== version || old.cancelled)
      throw Error("La cita cambió. Vuelve a abrirla.");
    const next = Object.freeze({
      ...old,
      day,
      start,
      version: old.version + 1,
    });
    this.validate(next);
    if (!this.free(next, id)) throw Error("Ese horario ya está ocupado.");
    await this.persist(
      this.state.rows.map((r) => (r.id === id ? next : r)),
      { day, view: "day" },
    );
  }
  async cancel(id: string, version: number) {
    const old = this.get(id);
    if (old.cancelled) return;
    if (old.version !== version)
      throw Error("La cita cambió. Vuelve a abrirla.");
    await this.persist(
      this.state.rows.map((r) =>
        r.id === id
          ? Object.freeze({ ...r, cancelled: true, version: r.version + 1 })
          : r,
      ),
    );
  }
}
