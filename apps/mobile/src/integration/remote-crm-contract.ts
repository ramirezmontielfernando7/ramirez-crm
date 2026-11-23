import { IntegrationError } from "./contracts";

const idShape = "[A-Za-z0-9_-]{1,200}";
const dateShape = "[0-9]{4}-[0-9]{2}-[0-9]{2}";
const contactPath = new RegExp(`^/api/contacts/${idShape}$`);
const timelinePath = new RegExp(`^/api/contacts/${idShape}/timeline$`);
const notesPath = new RegExp(`^/api/contacts/${idShape}/notes$`);
const tagsPath = new RegExp(`^/api/contacts/${idShape}/tags$`);
const taskPath = new RegExp(`^/api/work/tasks/${idShape}$`);
const bookingPath = new RegExp(`^/api/bookings/${idShape}$`);
const bookingRange = new RegExp(
  `^/api/bookings\\?from=(${dateShape})&to=(${dateShape})$`,
);

export function isRemoteId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{1,200}$/.test(value) &&
    !/\s/.test(value)
  );
}

export function validDate(value: string): boolean {
  const date = new Date(value);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

export function validInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

export function addCalendarDays(value: string, days: number): string {
  const date = new Date(value + "T12:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function businessDate(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((piece) => piece.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function allowsCrmRequest(
  method: string,
  path: string,
  writes: boolean,
): boolean {
  if (method === "GET") {
    const range = bookingRange.exec(path);
    if (range) {
      const [, from = "", to = ""] = range;
      return (
        validDate(from) &&
        validDate(to) &&
        from <= to &&
        Date.parse(to) - Date.parse(from) <= 6 * 86_400_000
      );
    }
    return (
      contactPath.test(path) ||
      timelinePath.test(path) ||
      path === "/api/contact-tags" ||
      path === "/api/settings/team" ||
      path === "/api/work/tasks?filter=all" ||
      (writes && path === "/api/calendar/availability")
    );
  }
  if (!writes) return false;
  if (method === "POST")
    return (
      notesPath.test(path) ||
      path === "/api/assignments" ||
      path === "/api/work/tasks" ||
      path === "/api/bookings"
    );
  if (method === "PUT") return tagsPath.test(path);
  return method === "PATCH" && (taskPath.test(path) || bookingPath.test(path));
}

export function crmRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new IntegrationError("invalid");
  return value as Record<string, unknown>;
}
function list<T>(
  value: unknown,
  parse: (row: Record<string, unknown>) => T,
): T[] {
  if (!Array.isArray(value)) throw new IntegrationError("invalid");
  return value.map((row) => parse(crmRecord(row)));
}
function identifier(value: unknown): string {
  if (!isRemoteId(value)) throw new IntegrationError("invalid");
  return value;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new IntegrationError("invalid");
  return value;
}
function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}
function instant(value: unknown): string {
  if (!validInstant(value)) throw new IntegrationError("invalid");
  return value;
}
function person(value: unknown) {
  if (value === null) return null;
  const row = crmRecord(value);
  return { id: identifier(row.id), name: string(row.name) };
}

export function crmTags(raw: unknown) {
  return list(crmRecord(raw).tags, (tag) => ({
    id: identifier(tag.id),
    name: string(tag.name),
  }));
}

export function crmContact(raw: unknown, expectedId: string) {
  const body = crmRecord(crmRecord(raw).contact);
  if (body.id !== expectedId) throw new IntegrationError("invalid");
  return {
    id: expectedId,
    name: string(body.name),
    phone: nullableString(body.phone),
    assignedUserId:
      body.assignedUserId === null ? null : identifier(body.assignedUserId),
    tags: crmTags(body),
  };
}

export function crmNotes(raw: unknown) {
  const { items } = crmRecord(raw);
  if (!Array.isArray(items)) throw new IntegrationError("invalid");
  return items
    .map(crmRecord)
    .filter((row) => row.kind === "note" || row.kind === "initial_note")
    .map((row) => ({
      id: identifier(row.id),
      at: instant(row.at),
      initial: row.kind === "initial_note",
      text: string(crmRecord(row.detail).text),
    }));
}

export function crmTeam(raw: unknown) {
  return list(crmRecord(raw).members, (row) => ({
    id: identifier(row.userId),
    name: string(row.name),
    ...(row.role === "owner" ||
    row.role === "coordinador" ||
    row.role === "asesor"
      ? { role: row.role }
      : {}),
  }));
}

export function crmTasks(raw: unknown) {
  return list(crmRecord(raw).tasks, (row) => ({
    id: identifier(row.id),
    title: string(row.title),
    description: nullableString(row.description),
    doneAt: row.doneAt === null ? null : instant(row.doneAt),
    canEdit: row.canEdit === true,
    assignee: person(row.assignee),
  }));
}

export function crmCalendar(raw: unknown) {
  const body = crmRecord(raw);
  const timezone = string(body.timezone);
  businessDate(timezone);
  return {
    timezone,
    truncated: body.truncated === true,
    bookings: list(body.bookings, (row) => ({
      id: identifier(row.id),
      kind: string(row.kind),
      status: string(row.status),
      isTest: row.isTest === true,
      date: string(row.date),
      time: string(row.time),
      scheduledAt: instant(row.scheduledAtUtc),
      contact: person(row.contact),
    })).filter((row) => !row.isTest),
  };
}

export function crmSlots(raw: unknown) {
  return list(crmRecord(raw).slots, (row) => ({
    startUtc: instant(row.startUtc),
    time: string(row.time),
    date: string(row.dayIso),
  }));
}

export function crmCreatedId(value: unknown) {
  return identifier(crmRecord(value).id);
}
