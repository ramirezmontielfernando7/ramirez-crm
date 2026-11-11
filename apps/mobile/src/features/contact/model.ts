import type { Actor, Conversation } from "../inbox/model";
export const team = [
  { id: "demo-owner", name: "Fer Ramírez", role: "Propietario" },
  { id: "demo-coordinator", name: "Ana López", role: "Coordinador" },
  { id: "demo-advisor", name: "Luis Ortega", role: "Asesor" },
] as const;
export const personName = (id: string | null) =>
  team.find((p) => p.id === id)?.name ?? "Sin asignar";
export const lossReasons = [
  "Precio",
  "Sin respuesta",
  "Compró con otro",
  "Ya no lo necesita",
  "Fuera de zona",
  "Otro",
] as const;
export const priorities = ["Sin prioridad", "Baja", "Media", "Alta"] as const;
export const modeLabels = {
  meta: "Meta",
  direct: "Conexión directa",
  hybrid: "Conexión híbrida",
} as const;
export type Mode = keyof typeof modeLabels;
export const eventKinds = [
  "Nota",
  "Etapa",
  "Asignación",
  "IA",
  "Etiquetas",
  "Consentimiento",
  "Conexión",
  "Tarea",
  "Venta",
] as const;
export type EventKind = (typeof eventKinds)[number];
export type Event = Readonly<{
  id: string;
  kind: EventKind;
  text: string;
  at: number;
}>;
export type ChatTask = Readonly<{
  id: string;
  title: string;
  due: number;
  assignee: string;
  done: boolean;
}>;
export type ContactData = Readonly<{
  version: 1;
  stage: string;
  assigned: string | null;
  tags: readonly string[];
  ai: Conversation["ai"];
  mode: Mode;
  amountCents: number | null;
  priority: string;
  lossReason: string;
  lossDetail: string;
  events: readonly Event[];
  tasks: readonly ChatTask[];
  sequence: number;
}>;
export type DemoFlags = Readonly<{
  addon: boolean;
  modeGrant: boolean;
  linked: boolean;
  emergency: boolean;
  agent: boolean;
  brain: boolean;
}>;
export const defaultFlags = (actor: Actor): DemoFlags => ({
  addon: false,
  modeGrant: actor.role === "coordinator",
  linked: false,
  emergency: false,
  agent: true,
  brain: false,
});
export const canAssign = (actor: Actor) => actor.role !== "advisor";
export const canChangeMode = (actor: Actor, c: Conversation, f: DemoFlags) =>
  f.addon && !c.group && (actor.role === "owner" || f.modeGrant);
export function modeProblem(
  actor: Actor,
  c: Conversation,
  f: DemoFlags,
  mode: Mode,
) {
  if (!canChangeMode(actor, c, f))
    return "Conexión del chat no está disponible para tu perfil o complemento.";
  if (!Object.keys(modeLabels).includes(mode))
    return "Elige una conexión válida.";
  if (mode === "meta") return "";
  if (f.emergency) return "Hay una pausa de emergencia. Puedes volver a Meta.";
  if (!f.linked)
    return "Hace falta un dispositivo vinculado para usar Directa o Híbrida.";
  return "";
}
export const protectedTags = (c: Conversation) =>
  c.tags.filter((t) => /^Importación\b/i.test(t));
export function parseAmount(value: string): number | null {
  if (!value.trim()) return null;
  const s = value.replace(/[$,\s]/g, "");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(s))
    throw new Error("Escribe un monto válido de hasta 99.999.999,99.");
  return Math.round(Number(s) * 100);
}
export function parseDue(date: string, time: string): number {
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date),
    t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) throw new Error("Usa DD/MM/AAAA y HH:mm.");
  const day = +d[1]!,
    month = +d[2]!,
    year = +d[3]!,
    hour = +t[1]!,
    minute = +t[2]!;
  const value = new Date(year, month - 1, day, hour, minute);
  if (
    year < 2000 ||
    year > 2100 ||
    value.getFullYear() !== year ||
    value.getMonth() !== month - 1 ||
    value.getDate() !== day ||
    value.getHours() !== hour ||
    value.getMinutes() !== minute
  )
    throw new Error("Fecha u hora no válida.");
  return value.getTime();
}
export const formatAmount = (cents: number | null) =>
  cents === null
    ? "—"
    : new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "MXN",
        maximumFractionDigits: cents % 100 ? 2 : 0,
      }).format(cents / 100);
export function seedDetails(c: Conversation, now: number): ContactData {
  const recent = [
    ["Nota", "Pidió cotización para 3 personas"],
    ["IA", "La IA pasó el chat a Ana López"],
    ["Etapa", "Nuevo → Interesado"],
    ["Asignación", `Asignado a ${personName(c.assigned)}`],
    ["Etiquetas", "Etiqueta «Promo nov»"],
    ["Consentimiento", "Opt-in por WhatsApp"],
  ] as const;
  return {
    version: 1,
    stage: c.stage,
    assigned: c.assigned,
    tags: c.tags,
    ai: c.ai,
    mode: "meta",
    amountCents: c.id === "demo-conv-1" ? 480000 : null,
    priority: c.id === "demo-conv-1" ? "Alta" : "Sin prioridad",
    lossReason: c.stage === "Perdido" ? "Sin respuesta" : "",
    lossDetail: "",
    sequence: 6,
    tasks: [],
    events: c.id.startsWith("demo-new-")
      ? []
      : recent.map(([kind, text], i) => ({
          id: `${c.id}:event:${6 - i}`,
          kind,
          text,
          at: now - (i + 1) * 60_000,
        })),
  };
}
