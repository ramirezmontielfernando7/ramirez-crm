"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, ListChecks, MessageCircle, Plus, Trash2, User, X } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import {
  isOverdue,
  TASK_DESCRIPTION_MAX,
  TASK_FILTER_LABEL,
  TASK_FILTERS,
  TASK_TITLE_MAX,
  type TaskDto,
  type TaskFilter,
} from "@/lib/work";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ContactSearch } from "./contact-search";

/**
 * 033 — Tareas, como los Recordatorios del iPhone: una lista con alta rápida
 * (escribe y Enter) y un círculo que marca la tarea como hecha de un toque; al
 * tocar una tarea se abre su detalle a la derecha (en el celular, encima).
 * Quién ve y edita qué lo decide el servidor (`canEdit`/`canDelete`).
 */

type Person = { id: string; name: string };
type DraftLink = { contactId: string; conversationId: string | null; name: string };
type Selected = { kind: "task"; id: string } | { kind: "new"; link: DraftLink | null } | null;

const PILL =
  "box-border h-7 shrink-0 rounded-full border px-3 text-[12px] font-semibold leading-none transition-colors";

const DAY = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });
const TIME = new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit" });

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** «Hoy 18:00», «Mañana», «12 oct». Sin hora si es fin de día (solo fecha). */
export function dueLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const day = sameDay(d, now) ? "Hoy" : sameDay(d, tomorrow) ? "Mañana" : DAY.format(d);
  const endOfDay = d.getHours() === 23 && d.getMinutes() === 59;
  return endOfDay ? day : `${day} ${TIME.format(d)}`;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** ISO → valores de los campos de fecha y hora (hora local de quien mira). */
function toFields(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const endOfDay = d.getHours() === 23 && d.getMinutes() === 59;
  return { date, time: endOfDay ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** Sin hora, la tarea vence al final de ese día. */
function fromFields(date: string, time: string): string | null {
  if (!date) return null;
  const d = new Date(`${date}T${time || "23:59"}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function TasksClient({
  people,
  me,
  draftLink,
}: {
  people: Person[];
  me: string;
  draftLink: DraftLink | null;
}) {
  const [filter, setFilter] = useState<TaskFilter>("mine");
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quick, setQuick] = useState("");
  const [selected, setSelected] = useState<Selected>(draftLink ? { kind: "new", link: draftLink } : null);
  // Lo que se acaba de palomear se queda un instante a la vista, tachado.
  const [justDone, setJustDone] = useState<Record<string, TaskDto>>({});
  // La tarea recién creada abre su detalle diciendo «Guardado».
  const [createdId, setCreatedId] = useState<string | null>(null);
  const seq = useRef(0);
  const now = useMemo(() => new Date(), [tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  const refetch = useCallback(async () => {
    const mine = ++seq.current;
    const res = await fetchJson<{ tasks: TaskDto[] }>(`/api/work/tasks?filter=${filter}`);
    if (mine !== seq.current) return;
    setLoaded(true);
    if (!res.ok) {
      setError(`No se pudieron cargar las tareas: ${res.error}`);
      return;
    }
    setError(null);
    setTasks(res.data.tasks);
  }, [filter]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Volver a la pestaña trae lo que el equipo cambió mientras tanto.
  useEffect(() => {
    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetch]);

  async function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    const title = quick.trim();
    if (!title) return;
    setQuick("");
    const res = await fetchJson<{ task: TaskDto }>("/api/work/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      setQuick(title);
      setError(`No se guardó la tarea: ${res.error}`);
      return;
    }
    if (filter === "done") setFilter("mine");
    else void refetch();
  }

  async function toggleDone(t: TaskDto) {
    const done = !t.doneAt;
    const optimistic = { ...t, doneAt: done ? new Date().toISOString() : null };
    setTasks((prev) => prev.map((x) => (x.id === t.id ? optimistic : x)));
    if (done) setJustDone((prev) => ({ ...prev, [t.id]: optimistic }));
    const res = await fetchJson<{ task: TaskDto }>(`/api/work/tasks/${t.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ done }),
    });
    if (!res.ok) {
      setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)));
      setJustDone((prev) => {
        const next = { ...prev };
        delete next[t.id];
        return next;
      });
      setError(`No se pudo marcar: ${res.error}`);
      return;
    }
    window.setTimeout(() => {
      setJustDone((prev) => {
        const next = { ...prev };
        delete next[t.id];
        return next;
      });
      void refetch();
    }, 700);
  }

  const selectedTask = selected?.kind === "task" ? tasks.find((t) => t.id === selected.id) ?? null : null;
  const panelOpen = selected?.kind === "new" || selectedTask !== null;

  return (
    <div className="flex h-full min-h-0">
      {/* Lista */}
      <section
        className={cn(
          "flex min-h-0 w-full flex-col md:w-[380px] md:shrink-0 md:border-r",
          panelOpen && "max-md:hidden"
        )}
        aria-label="Tareas"
        aria-busy={!loaded}
      >
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2 pt-3">
          {TASK_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                PILL,
                filter === f ? "border-brand bg-brand-veil text-foreground" : "text-text-3 hover:bg-accent"
              )}
            >
              {TASK_FILTER_LABEL[f]}
            </button>
          ))}
        </div>

        <form onSubmit={quickAdd} className="flex items-center gap-1.5 px-4 pb-2">
          <Input
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            maxLength={TASK_TITLE_MAX}
            placeholder="Agregar tarea y presionar Enter…"
            aria-label="Agregar tarea"
          />
          <button
            type="button"
            onClick={() => setSelected({ kind: "new", link: null })}
            className="shrink-0 rounded-full p-1.5 text-brand hover:bg-brand-veil"
            aria-label="Nueva tarea con detalles"
            title="Nueva tarea con detalles"
          >
            <Plus className="h-5 w-5" strokeWidth={2} />
          </button>
        </form>

        {error && (
          <p role="alert" className="mx-4 mb-2 rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
            {error}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loaded && tasks.length === 0 ? (
            <div className="mx-auto mt-14 max-w-xs px-4 text-center">
              <ListChecks className="mx-auto mb-3 h-8 w-8 text-text-3" strokeWidth={1.5} />
              <p className="font-semibold">
                {filter === "done" ? "Nada hecho todavía" : filter === "overdue" ? "Nada vencido" : "Sin pendientes"}
              </p>
              <p className="mt-1 text-sm text-text-3">
                {filter === "done"
                  ? "Lo que marques como hecho aparece aquí."
                  : "Escribe arriba lo que hay que hacer y presiona Enter."}
              </p>
            </div>
          ) : (
            <ul>
              {tasks.map((t) => {
                const shown = justDone[t.id] ?? t;
                const done = !!shown.doneAt;
                const late = isOverdue(shown, now);
                const active = selected?.kind === "task" && selected.id === t.id;
                return (
                  <li key={t.id} className={cn("flex items-start gap-3 px-4 py-2.5", active ? "bg-brand-veil" : "hover:bg-accent")}>
                    <button
                      onClick={() => t.canEdit && void toggleDone(t)}
                      disabled={!t.canEdit}
                      aria-label={done ? `Marcar «${t.title}» como pendiente` : `Marcar «${t.title}» como hecha`}
                      aria-pressed={done}
                      className={cn(
                        "mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        done ? "border-brand bg-brand text-brand-fg" : "border-text-3 hover:border-brand",
                        !t.canEdit && "opacity-40"
                      )}
                    >
                      {done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                    </button>
                    <button
                      onClick={() => setSelected({ kind: "task", id: t.id })}
                      className="min-w-0 flex-1 border-b pb-2.5 text-left"
                    >
                      <span className={cn("block break-words text-[14px] leading-snug", done && "text-text-3 line-through")}>
                        {t.title}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-text-3">
                        {t.dueAt && (
                          <span className={cn("inline-flex items-center gap-1", late && "font-semibold text-danger-text")}>
                            <CalendarClock className="h-3 w-3" strokeWidth={2} />
                            {dueLabel(t.dueAt, now)}
                          </span>
                        )}
                        {t.assignee && t.assignee.id !== me && (
                          <span className="inline-flex items-center gap-1">
                            <User className="h-3 w-3" strokeWidth={2} />
                            {t.assignee.name}
                          </span>
                        )}
                        {t.contact && (
                          <span className="inline-flex items-center gap-1">
                            <MessageCircle className="h-3 w-3" strokeWidth={2} />
                            {t.contact.name}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Detalle */}
      <section className={cn("min-h-0 flex-1", !panelOpen && "max-md:hidden")} aria-label="Detalle de la tarea">
        {selected?.kind === "new" ? (
          <TaskEditor
            key={`new-${selected.link?.contactId ?? ""}`}
            task={null}
            link={selected.link}
            people={people}
            me={me}
            onClose={() => setSelected(null)}
            onSaved={(t) => {
              setCreatedId(t.id);
              setSelected({ kind: "task", id: t.id });
              setTasks((prev) => [t, ...prev.filter((x) => x.id !== t.id)]);
              void refetch();
            }}
            onDeleted={() => undefined}
          />
        ) : selectedTask ? (
          <TaskEditor
            key={selectedTask.id}
            task={selectedTask}
            link={null}
            justCreated={createdId === selectedTask.id}
            people={people}
            me={me}
            onClose={() => setSelected(null)}
            onSaved={(t) => setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)))}
            onDeleted={() => {
              setSelected(null);
              void refetch();
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div className="max-w-xs">
              <ListChecks className="mx-auto mb-3 h-8 w-8 text-text-3" strokeWidth={1.5} />
              <p className="text-sm text-text-3">Toca una tarea para ver o cambiar sus detalles.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function TaskEditor({
  task,
  link,
  people,
  me,
  onClose,
  onSaved,
  onDeleted,
  justCreated = false,
}: {
  justCreated?: boolean;
  task: TaskDto | null;
  link: DraftLink | null;
  people: Person[];
  me: string;
  onClose: () => void;
  onSaved: (t: TaskDto) => void;
  onDeleted: () => void;
}) {
  const editable = task ? task.canEdit : true;
  const initialDue = toFields(task?.dueAt ?? null);
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [date, setDate] = useState(initialDue.date);
  const [time, setTime] = useState(initialDue.time);
  const [assignee, setAssignee] = useState<string>(task ? task.assignee?.id ?? "" : me);
  const [contact, setContact] = useState<{ id: string; name: string; conversationId: string | null } | null>(
    task?.contact
      ? { ...task.contact, conversationId: task.conversationId }
      : link
        ? { id: link.contactId, name: link.name, conversationId: link.conversationId }
        : null
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(justCreated ? Date.now() : null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Escribe qué hay que hacer");
      return;
    }
    setSaving(true);
    setError(null);
    const contactChanged = (contact?.id ?? null) !== (task?.contact?.id ?? null);
    const body: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || null,
      dueAt: fromFields(date, time),
      assigneeUserId: assignee || null,
    };
    // Una tarea ligada a un contacto que quien edita no ve conserva su ligadura.
    if (!task || contactChanged) {
      if (contact?.conversationId) body.conversationId = contact.conversationId;
      else body.contactId = contact?.id ?? null;
    }
    const res = await fetchJson<{ task: TaskDto }>(task ? `/api/work/tasks/${task.id}` : "/api/work/tasks", {
      method: task ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSavedAt(Date.now());
    onSaved(res.data.task);
  }

  async function remove() {
    if (!task || !window.confirm(`¿Borrar «${task.title}»? No se puede deshacer.`)) return;
    const res = await fetchJson(`/api/work/tasks/${task.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onDeleted();
  }

  return (
    <form onSubmit={save} className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2.5 sm:px-6">
        <button
          type="button"
          onClick={onClose}
          className="-ml-1.5 rounded-full p-1.5 text-text-3 hover:bg-accent hover:text-foreground"
          aria-label="Cerrar detalle"
        >
          <X className="h-4 w-4" />
        </button>
        <p className="text-sm font-semibold">{task ? "Tarea" : "Nueva tarea"}</p>
        {task?.doneAt && (
          <span className="rounded-full bg-success-tint px-2 py-0.5 text-[11px] font-semibold text-success-text">
            Hecha{task.doneBy ? ` por ${task.doneBy.name}` : ""}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {task?.canDelete && (
            <button
              type="button"
              onClick={() => void remove()}
              className="rounded-full p-1.5 text-text-3 hover:bg-danger-tint hover:text-danger-text"
              aria-label="Borrar tarea"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.7} />
            </button>
          )}
          {editable && (
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <fieldset disabled={!editable} className="mx-auto flex max-w-xl flex-col gap-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={TASK_TITLE_MAX}
            placeholder="¿Qué hay que hacer?"
            aria-label="Título"
            autoFocus={!task}
            className="w-full bg-transparent text-[19px] font-semibold tracking-tight outline-none placeholder:text-text-3"
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={TASK_DESCRIPTION_MAX}
            placeholder="Notas o detalles (opcional)"
            aria-label="Descripción"
            rows={4}
          />

          <Field label="Fecha límite">
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha límite" className="w-auto" />
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                disabled={!date}
                aria-label="Hora (opcional)"
                className="w-auto"
              />
              {date && (
                <button
                  type="button"
                  onClick={() => {
                    setDate("");
                    setTime("");
                  }}
                  className="text-xs text-text-3 underline-offset-2 hover:underline"
                >
                  Quitar fecha
                </button>
              )}
            </div>
          </Field>

          <Field label="Responsable">
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              aria-label="Responsable"
              className="h-9 w-full max-w-xs rounded-md border border-input bg-card px-2 text-sm"
            >
              <option value="">Sin responsable</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === me ? `${p.name} (yo)` : p.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Contacto">
            {task?.hiddenContact && !contact ? (
              <p className="text-sm text-text-3">Ligada a un contacto que no tienes asignado.</p>
            ) : contact ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-tint px-2.5 py-1 text-[12.5px] font-semibold text-brand-text">
                  <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} />
                  {contact.name}
                  {editable && (
                    <button
                      type="button"
                      onClick={() => setContact(null)}
                      aria-label="Quitar contacto"
                      className="-mr-1 rounded-full p-0.5 hover:bg-brand-veil"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
                <Link href={`/inbox?contact=${encodeURIComponent(contact.id)}`} className="text-sm text-brand-text underline-offset-2 hover:underline">
                  Abrir chat
                </Link>
              </div>
            ) : (
              <ContactSearch onPick={(c) => setContact({ ...c, conversationId: null })} />
            )}
          </Field>

          {task && (
            <p className="font-mono text-[10.5px] tracking-[0.04em] text-text-3">
              Creada por {task.createdBy?.name ?? "—"}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
              {error}
            </p>
          )}
          {savedAt && !error && (
            <p role="status" className="text-sm text-success-text">
              Guardado
            </p>
          )}
        </fieldset>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="kicker">{label}</span>
      {children}
    </div>
  );
}
