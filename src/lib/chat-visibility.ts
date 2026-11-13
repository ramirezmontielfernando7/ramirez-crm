/**
 * Qué chats de clientes ve un ASESOR. Es un ajuste de la empresa; Propietario
 * y Coordinador siempre ven todo.
 *
 * - `own`: solo los suyos (lo de siempre).
 * - `unassigned`: los suyos y los que nadie tiene todavía; puede «Tomar» uno.
 * - `all`: todos los chats de clientes.
 */
export const CHAT_VIEWS = ["own", "unassigned", "all"] as const;
export type ChatView = (typeof CHAT_VIEWS)[number];

export const DEFAULT_CHAT_VIEW: ChatView = "own";

export function isChatView(value: unknown): value is ChatView {
  return typeof value === "string" && (CHAT_VIEWS as readonly string[]).includes(value);
}

export function normalizeChatView(value: unknown): ChatView {
  return isChatView(value) ? value : DEFAULT_CHAT_VIEW;
}

export const CHAT_VIEW_OPTIONS: { value: ChatView; label: string; hint: string }[] = [
  { value: "own", label: "Solo los suyos", hint: "Cada asesor ve únicamente los chats que tiene asignados." },
  {
    value: "unassigned",
    label: "Los suyos y los sin asignar",
    hint: "Ven también los chats que nadie tiene y los toman con «Tomar este chat».",
  },
  { value: "all", label: "Todos los chats", hint: "Todos los asesores ven todos los chats de clientes." },
];
