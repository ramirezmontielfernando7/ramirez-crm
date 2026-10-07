/**
 * 033 — Trabajo (Tareas). Reglas puras: las usan el servidor (rutas y
 * consultas) y la pantalla. Sin servidor ni React.
 *
 * Quién ve y quién edita una tarea, en una línea: lo suyo (la creó o es su
 * responsable) cualquiera; lo de todos, quien tiene `work.manage`
 * (Propietario y Coordinador).
 */

export const TASK_FILTERS = ["mine", "all", "overdue", "done"] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number];

export const TASK_FILTER_LABEL: Record<TaskFilter, string> = {
  mine: "Mis tareas",
  all: "Todas",
  overdue: "Vencidas",
  done: "Hechas",
};

export function isTaskFilter(value: unknown): value is TaskFilter {
  return typeof value === "string" && (TASK_FILTERS as readonly string[]).includes(value);
}

export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 4000;

/** Lo que la pantalla recibe de una tarea. */
export type TaskDto = {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  assignee: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
  /**
   * El contacto ligado, SOLO si quien mira puede verlo (020). Si no lo puede
   * ver, `hiddenContact` avisa que hay uno sin decir cuál.
   */
  contact: { id: string; name: string } | null;
  hiddenContact: boolean;
  conversationId: string | null;
  doneAt: string | null;
  doneBy: { id: string; name: string } | null;
  createdAt: string;
  /** Lo calcula el servidor para quien pide (la pantalla no adivina). */
  canEdit: boolean;
  canDelete: boolean;
};

/** Lo mínimo de una tarea para decidir permisos. */
export type TaskOwnership = { createdBy: string | null; assigneeUserId: string | null };

/** Editar o marcar hecha: quien la creó, su responsable, o `work.manage`. */
export function canEditTask(t: TaskOwnership, userId: string, manages: boolean): boolean {
  return manages || t.createdBy === userId || t.assigneeUserId === userId;
}

/** Borrar: quien la creó, o `work.manage` (el responsable solo la marca hecha). */
export function canDeleteTask(t: TaskOwnership, userId: string, manages: boolean): boolean {
  return manages || t.createdBy === userId;
}

/** ¿Venció? Pendiente y con fecha límite ya pasada. */
export function isOverdue(t: { dueAt: Date | string | null; doneAt: Date | string | null }, now: Date): boolean {
  if (t.doneAt || !t.dueAt) return false;
  return new Date(t.dueAt).getTime() < now.getTime();
}

/* ── 033, PR 2 — Notas ─────────────────────────────────────────────── */

/** Colores de una nota (lista cerrada; la BD tiene el mismo CHECK). */
export const NOTE_COLORS = ["ninguno", "amarillo", "verde", "azul", "rosa", "morado"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export const NOTE_COLOR_LABEL: Record<NoteColor, string> = {
  ninguno: "Sin color",
  amarillo: "Amarillo",
  verde: "Verde",
  azul: "Azul",
  rosa: "Rosa",
  morado: "Morado",
};

export function isNoteColor(value: unknown): value is NoteColor {
  return typeof value === "string" && (NOTE_COLORS as readonly string[]).includes(value);
}

export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX = 10000;

/**
 * La línea que explica quién ve una nota (la pide el dueño, 2026-10-07).
 * Va junto a «Nueva nota» del chat y en el editor de una nota ligada.
 */
export const NOTE_VISIBILITY_HINT =
  "Las notas ligadas a un chat las ve todo el equipo que puede ver ese contacto. Una nota sin ligar es solo para quien la escribe.";

/** Lo que la pantalla recibe de una nota. */
export type NoteDto = {
  id: string;
  title: string | null;
  body: string;
  color: NoteColor;
  pinned: boolean;
  archived: boolean;
  author: { id: string; name: string } | null;
  /** El contacto ligado, SOLO si quien mira puede verlo. */
  contact: { id: string; name: string } | null;
  /** Ligada a un contacto que quien mira ya no ve (p. ej. lo reasignaron). */
  hiddenContact: boolean;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
};

/** Editar, fijar, archivar o borrar: quien la escribió, o `work.manage`. */
export function canEditNote(n: { authorUserId: string | null }, userId: string, manages: boolean): boolean {
  return manages || n.authorUserId === userId;
}
