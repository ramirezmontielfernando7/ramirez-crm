/**
 * 038 (PR 1) — Asistente interno: contrato y textos (puro, sin servidor ni
 * React). El asistente es SOLO LECTURA sobre los datos de la propia
 * organización: nunca envía mensajes ni cambia nada.
 */
import type { Gauge } from "@/lib/usage-visibility";

/**
 * - `available`: puede responder.
 * - `exhausted`: agotó su tope propio del mes.
 * - `ai_exhausted`: la IA de la organización (el total) llegó a su tope.
 * - `unset`: no tiene tope asignado (el asistente nunca corre sin tope).
 * - `not_configured`: la instancia no tiene proveedor de IA.
 */
export type AssistantState = "available" | "exhausted" | "ai_exhausted" | "unset" | "not_configured";

export type AssistantStatus = {
  state: AssistantState;
  /** ¿Puede hacer una pregunta ahora? */
  canAsk: boolean;
  /** Lo que se le dice al Propietario (sin dólares ni tokens). */
  message: string;
  /** El crédito del asistente, ya recortado a la visibilidad de la organización; `null` sin tope. */
  gauge: Gauge | null;
  /** Cuándo se renueva el crédito (primer día del mes siguiente, UTC), 'YYYY-MM-DD'. */
  resetsOn: string;
  /** Cuándo aceptó esta persona el aviso de consumo; `null` = aún no (se le muestra antes de usarlo). */
  noticeAcceptedAt: string | null;
};

/** El aviso fijo de la pantalla y el de la confirmación antes del primer uso. */
export const ASSISTANT_NOTICE_TITLE = "Antes de usar el asistente";
export const ASSISTANT_COST_NOTICE =
  "Cada pregunta al asistente consume bastante crédito de IA, porque revisa muchos datos para contestarte. El crédito del mes se puede agotar rápido; cuando se acaba, el asistente se detiene hasta el mes siguiente.";
export const ASSISTANT_READ_ONLY_NOTICE =
  "El asistente solo lee los datos de tu organización: no envía mensajes a tus clientes, no toca campañas y no cambia nada.";

/** «1 de noviembre» a partir de 'YYYY-MM-DD' (UTC). */
export function resetLabel(resetsOn: string): string {
  const [y, m, d] = resetsOn.split("-").map(Number);
  if (!y || !m || !d) return resetsOn;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-MX", { day: "numeric", month: "long", timeZone: "UTC" });
}

/** El primer día del mes siguiente (UTC), 'YYYY-MM-DD'. */
export function nextResetDate(now = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toISOString().slice(0, 10);
}

/** El mensaje de cada estado: claro, sin cifras ni dólares. */
export function assistantMessage(state: AssistantState, resetsOn: string): string {
  const vuelve = resetLabel(resetsOn);
  switch (state) {
    case "available":
      return "El asistente está disponible.";
    case "exhausted":
      return `El asistente agotó su crédito de este mes y se detuvo. Vuelve a estar disponible el ${vuelve}. Si necesitas más, habla con quien administra la plataforma.`;
    case "ai_exhausted":
      return `La IA de tu organización llegó a su tope de este mes, así que el asistente se detuvo. Vuelve a estar disponible el ${vuelve}.`;
    case "unset":
      return "El asistente aún no tiene un crédito asignado. Pide a quien administra la plataforma que lo configure.";
    case "not_configured":
      return "La IA no está configurada en esta instalación: el asistente no puede responder.";
  }
}
