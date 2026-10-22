/**
 * Conexión directa (PR 3) — reglas PURAS del envío por el dispositivo
 * vinculado: por dónde sale un mensaje, cuándo le toca salir (límites de
 * envío y fila), «escribiendo…» y el freno de emergencia. Sin BD ni red:
 * todo se prueba en `tests/unit/conexion-directa-envio.test.ts`.
 */

import {
  DIRECT_TEXT,
  effectiveMode,
  outboundTransportOf,
  type ConnectionMode,
  type DirectConnectionStatus,
  type DirectSettings,
} from "@/lib/direct-connection";
import { normalizeMx } from "@/lib/meta/mx";

/* ───────── ¿Por dónde sale? ───────── */

export type DirectConnectionState = {
  status: DirectConnectionStatus;
  pausedUntil: Date | null;
};

export type RouteInput = {
  /** El módulo `conexion_directa` de la organización. */
  moduleOn: boolean;
  /** Solo un envío de una PERSONA desde la Bandeja puede ir por la directa. */
  allowDirect: boolean;
  channel: string;
  chatMode: ConnectionMode | null;
  settings: Pick<DirectSettings, "defaultMode" | "preferMetaInWindow">;
  /** null = la organización nunca vinculó un dispositivo. */
  connection: DirectConnectionState | null;
  windowOpen: boolean;
  now: Date;
};

export type Route =
  | { via: "meta" }
  | { via: "directa" }
  /** El chat pide la directa pero hoy no se puede: falla claro, sin caer a Meta. */
  | { via: "unavailable"; reason: "paused" | "disconnected" };

/**
 * Por dónde sale un mensaje. Sin el módulo, sin permiso de usar la directa
 * (IA, campañas, cerebro externo, bajas automáticas), fuera de WhatsApp, en
 * modo Meta o sin dispositivo vinculado: Meta, exactamente como antes.
 */
export function routeFor(input: RouteInput): Route {
  if (!input.moduleOn || !input.allowDirect || input.channel !== "whatsapp") return { via: "meta" };
  const mode = effectiveMode(input.chatMode, input.settings.defaultMode);
  if (outboundTransportOf(mode) === "meta") return { via: "meta" };
  if (!input.connection || input.connection.status === "pending") return { via: "meta" };
  // «Usar Meta mientras la ventana de 24 h esté abierta» (encendido de fábrica).
  if (input.settings.preferMetaInWindow && input.windowOpen) return { via: "meta" };
  if (isPaused(input.connection, input.now)) return { via: "unavailable", reason: "paused" };
  if (input.connection.status !== "connected") return { via: "unavailable", reason: "disconnected" };
  return { via: "directa" };
}

export function isPaused(c: { pausedUntil: Date | null }, now: Date): boolean {
  return c.pausedUntil !== null && c.pausedUntil.getTime() > now.getTime();
}

/** Lo que ve quien envía cuando la directa no está disponible. */
export function unavailableText(reason: "paused" | "disconnected" | "module_off"): string {
  if (reason === "paused") return DIRECT_TEXT.emergencyPause;
  if (reason === "module_off") return "La conexión directa está apagada para esta empresa.";
  return DIRECT_TEXT.disconnected;
}

/**
 * El número tal como lo espera el dispositivo: solo dígitos, con la misma
 * normalización de México que la identidad (521 → 52). null si el contacto no
 * tiene teléfono (solo BSUID): por la directa no hay a dónde mandarlo.
 */
export function directNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return normalizeMx(digits);
}

/* ───────── Límites de envío y fila ───────── */

export type SlotLimits = {
  enabled: boolean;
  minIntervalSeconds: number;
  perChatPerMinute: number;
  perHour: number;
};

/** Lo ya enviado o en fila por la directa en la última hora (hora de salida de cada uno). */
export type RecentSend = { at: Date; conversationId: string };

/** Más allá de esto la fila no acepta: la persona debe esperar. */
export const MAX_QUEUE_MS = 24 * 60 * 60 * 1000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * La primera hora en que este mensaje puede salir sin romper los límites:
 * 1 cada `minIntervalSeconds` en toda la cuenta, `perChatPerMinute` por chat
 * en cualquier minuto y `perHour` en cualquier hora. Siempre DESPUÉS del
 * último ya agendado (la fila sale en orden y nunca en ráfaga). Con los
 * límites apagados, ya.
 */
export function nextSlot(now: Date, conversationId: string, recent: readonly RecentSend[], limits: SlotLimits): Date {
  if (!limits.enabled) return now;
  const all = recent.map((r) => r.at.getTime()).sort((a, b) => a - b);
  const chat = recent
    .filter((r) => r.conversationId === conversationId)
    .map((r) => r.at.getTime())
    .sort((a, b) => a - b);

  let s = now.getTime();
  const last = all[all.length - 1];
  if (last !== undefined) s = Math.max(s, last + limits.minIntervalSeconds * 1000);

  // `s` solo crece, y todo lo agendado queda antes de `s`: converge.
  for (let i = 0; i < 1000; i++) {
    const before = s;
    s = Math.max(s, windowRelease(chat, s, MINUTE, limits.perChatPerMinute));
    s = Math.max(s, windowRelease(all, s, HOUR, limits.perHour));
    if (s === before) break;
  }
  return new Date(s);
}

/**
 * En una ventana deslizante de `span` que termina en `s`, ¿caben `max`? Si
 * no, la hora en que sale de la ventana el que estorba.
 */
function windowRelease(sorted: readonly number[], s: number, span: number, max: number): number {
  const inWindow = sorted.filter((t) => t > s - span && t <= s);
  if (inWindow.length < max) return s;
  return inWindow[inWindow.length - max]! + span;
}

/** «escribiendo…» de 1 a 3 segundos, como una persona. */
export function typingDelayMs(random: () => number = Math.random): number {
  return 1000 + Math.floor(random() * 2000);
}

/** Pasado esto, un envío que se quedó a medias (reinicio) se da por fallido sin reenviar. */
export const STUCK_SEND_MS = 2 * MINUTE;

/* ───────── Fallos y freno de emergencia ───────── */

export type FailureKind = "ban" | "connection" | "recipient" | "request";

const BAN = /\bbann?ed\b|\bblocked\b|account (?:is )?(?:restricted|suspended)|\bspam\b/i;
const CONNECTION = /connection closed|not connected|disconnected|logged ?out|instance .*not (?:found|exist)|state.*close|timed? ?out/i;

/**
 * Qué clase de fallo fue. Solo `ban` y `connection` cuentan para el freno;
 * un número que no tiene WhatsApp (`recipient`) o un archivo rechazado
 * (`request`) son problemas de ESE mensaje, no del dispositivo.
 */
export function classifyFailure(err: { status: number; message: string; details?: unknown; timedOut?: boolean }): FailureKind {
  const blob = `${err.message} ${safeJson(err.details)}`;
  if (BAN.test(blob)) return "ban";
  if (err.timedOut || err.status === 0 || err.status >= 500) return "connection";
  if (err.status === 401 || err.status === 403 || err.status === 404) return "connection";
  if (/"exists"\s*:\s*false/.test(blob)) return "recipient";
  if (CONNECTION.test(blob)) return "connection";
  return "request";
}

function safeJson(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

export const BRAKE_FAILURES = 2;
export const BRAKE_WINDOW_MS = 24 * HOUR;
export const BRAKE_PAUSE_MS = 24 * HOUR;

export type BrakeState = {
  disconnectCount: number;
  disconnectWindowStart: Date | null;
  pausedUntil: Date | null;
  pauseReason: "ban" | "disconnects" | "manual" | null;
};

/**
 * El freno de emergencia: 2 fallos del dispositivo en 24 h (o uno que parece
 * bloqueo) apagan la conexión directa 24 h para la organización. Mismas
 * columnas y misma regla que las desconexiones que cuenta el PR 2. Devuelve
 * null si este fallo no cuenta.
 */
export function brakeAfterFailure(state: BrakeState, kind: FailureKind, now: Date): BrakeState | null {
  if (kind !== "ban" && kind !== "connection") return null;
  const fresh =
    !state.disconnectWindowStart || now.getTime() - state.disconnectWindowStart.getTime() >= BRAKE_WINDOW_MS;
  const count = fresh ? 1 : state.disconnectCount + 1;
  const windowStart = fresh ? now : state.disconnectWindowStart;
  const trip = kind === "ban" || count >= BRAKE_FAILURES;
  if (!trip) return { ...state, disconnectCount: count, disconnectWindowStart: windowStart };
  const until = new Date(now.getTime() + BRAKE_PAUSE_MS);
  return {
    disconnectCount: count,
    disconnectWindowStart: windowStart,
    // Una pausa más larga que ya estuviera puesta no se acorta.
    pausedUntil: state.pausedUntil && state.pausedUntil > until ? state.pausedUntil : until,
    pauseReason: kind === "ban" ? "ban" : (state.pauseReason === "ban" ? "ban" : "disconnects"),
  };
}

/** Lo que ve quien envía cuando el dispositivo falló (sin nombres de servidor). */
export function failureText(kind: FailureKind): string {
  switch (kind) {
    case "recipient":
      return "Este número no tiene WhatsApp: no se pudo enviar por conexión directa.";
    case "request":
      return "El dispositivo vinculado rechazó este mensaje.";
    default:
      return "El dispositivo vinculado no respondió: el mensaje no salió por conexión directa.";
  }
}
