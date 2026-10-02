import { logger } from "@/lib/log";
import { SendError } from "@/server/inbox/send";
import { TemplateError } from "@/server/whatsapp/templates";

const log = logger("campaign");

/**
 * Campañas v2 (PR 2) — Qué hacer con cada error de un envío de campaña.
 *
 * - `pause`: afecta a TODOS los destinatarios (token vencido, plantilla que
 *   dejó de servir, número frenado por calidad). La campaña se pausa con el
 *   motivo; el destinatario vuelve a la fila y nadie se "quema".
 * - `retry`: transitorio (límite de ritmo de Meta, Meta caído). Se reintenta
 *   ESE destinatario más tarde, con espera creciente y un tope de intentos.
 * - `fail`: solo ese destinatario. `countsForHealth` dice si el fallo habla
 *   de la salud del número (para la pausa por tasa de fallos): un número sin
 *   WhatsApp (131026), el límite de marketing por usuario de Meta (131049) o
 *   quien dejó de recibir marketing (131050) no dicen nada del número.
 *
 * 131049 NO se reintenta: Meta lo retiene para "cuidar el ecosistema" y
 * reintentar antes de 24 h no sirve.
 */
export type SendDecision =
  | { kind: "pause"; reason: string; code: number | null }
  | { kind: "retry"; reason: string; code: number | null; rateLimit: boolean }
  | { kind: "fail"; reason: string; code: number | null; countsForHealth: boolean };

/** Límite de ritmo / rendimiento: frenar y reintentar. */
export const RATE_LIMIT_CODES = new Set([4, 80007, 130429]);
/** Meta frenó el número por calidad: seguir empeora la reputación. */
export const QUALITY_STOP_CODES = new Set([131048]);
/** La plantilla dejó de servir: fallaría con todos. */
export const TEMPLATE_STOP_CODES = new Set([132000, 132001, 132005, 132007, 132012, 132015, 132016]);
/** Fallos del destinatario que NO dicen nada de la salud del número. */
export const NOT_HEALTH_CODES = new Set([131026, 131049, 131050]);

export function classifySendError(err: unknown): SendDecision {
  if (err instanceof TemplateError) {
    if (err.code === "not_connected" || err.code === "reconnect_required") {
      return { kind: "pause", reason: `WhatsApp desconectado: ${err.message}`, code: null };
    }
    if (err.code === "not_found" && /plantilla/i.test(err.message)) {
      return { kind: "pause", reason: "La plantilla ya no existe", code: null };
    }
    if (err.code === "invalid" && /aprobadas/i.test(err.message)) {
      return { kind: "pause", reason: "La plantilla dejó de estar aprobada o activa en Meta", code: null };
    }
    return { kind: "fail", reason: err.message, code: null, countsForHealth: false };
  }
  if (err instanceof SendError) {
    const code = err.metaCode ?? null;
    if (err.code === "reconnect_required" || err.code === "not_connected") {
      return { kind: "pause", reason: `WhatsApp desconectado: ${err.message}`, code };
    }
    if (code !== null && RATE_LIMIT_CODES.has(code)) {
      return { kind: "retry", reason: `Meta pidió bajar el ritmo (código ${code})`, code, rateLimit: true };
    }
    if (code !== null && QUALITY_STOP_CODES.has(code)) {
      return {
        kind: "pause",
        reason: `Meta frenó los envíos del número por calidad (código ${code}). Revisa la calidad del número antes de reanudar.`,
        code,
      };
    }
    if (code !== null && TEMPLATE_STOP_CODES.has(code)) {
      return { kind: "pause", reason: `Meta rechazó la plantilla (código ${code}): ${err.message}`, code };
    }
    if (err.code === "meta_unavailable") {
      return { kind: "retry", reason: "Meta no está disponible ahora", code, rateLimit: false };
    }
    if (err.code === "sandbox_violation") {
      return { kind: "fail", reason: "Contacto de pruebas del Laboratorio: no se envía", code: null, countsForHealth: false };
    }
    return {
      kind: "fail",
      reason: humanMetaError(code, err.message),
      code,
      countsForHealth: code === null || !NOT_HEALTH_CODES.has(code),
    };
  }
  log.error("error inesperado al enviar", { err });
  return { kind: "fail", reason: "Error interno al enviar a este contacto", code: null, countsForHealth: false };
}

export function humanMetaError(code: number | null, raw: string): string {
  if (code === 131026) return "El número no tiene WhatsApp o no puede recibir mensajes (131026)";
  if (code === 131049) {
    return "Meta no lo entregó para cuidar la experiencia del usuario: ya recibió muchas promociones hoy (131049). No se reintenta.";
  }
  if (code === 131056) return "Demasiados mensajes seguidos a este número (131056)";
  if (code === 131047) return "Fuera de la ventana de 24 h (131047)";
  if (code === 131050) return "El contacto dejó de recibir mensajes de marketing de este negocio (131050)";
  return raw;
}

/** Espera antes del intento `attempt` (1, 2…) tras un error transitorio. */
export const RETRY_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000];
export const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length;

/** En pruebas el reloj se acorta: nadie espera 2 minutos a un test. */
export function backoffScale(): number {
  const n = Number(process.env.CAMPAIGN_BACKOFF_SCALE ?? "");
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

export function retryDelayMs(attempts: number): number {
  const i = Math.min(Math.max(attempts, 1), RETRY_BACKOFF_MS.length) - 1;
  return RETRY_BACKOFF_MS[i]! * backoffScale();
}
