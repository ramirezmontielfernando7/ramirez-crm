import type { CampaignSettingsDto } from "@/lib/campaigns";

/**
 * Campañas v2 (PR 2) — Pausa de seguridad automática. Reglas puras (sin BD
 * ni red): las usa el despachador y las pruebas.
 *
 * Umbrales configurables por organización (`campaign_settings`):
 * - Tasa de fallos ≥ `failRatePercent` % en los últimos `failRateWindow`
 *   intentos (con al menos ese número de intentos). Solo cuentan los fallos
 *   que hablan de la salud del número (ver `NOT_HEALTH_CODES`).
 * - Calidad ROJA del número (si `pauseOnQualityRed`). AMARILLA solo avisa.
 * - Un aviso de cuenta (`account_update`) de restricción o desactivación.
 * - Uso del límite de 24 h ≥ `usagePausePercent` %: pausa y se reintenta
 *   sola en `USAGE_RETRY_MS` (la ventana de 24 h es móvil).
 * El límite NO está en el código: se lee de Meta (salud del número).
 */

export const USAGE_RETRY_MS = 30 * 60 * 1000;

export type SafetyInput = {
  settings: Pick<CampaignSettingsDto, "failRatePercent" | "failRateWindow" | "pauseOnQualityRed" | "usagePausePercent">;
  /** Últimos intentos que hablan de la salud del número, del más nuevo al más viejo. */
  recent: { failed: boolean }[];
  quality: string | null;
  accountEvent: Record<string, unknown> | null;
  usage: number;
  limit: number | null;
  now?: Date;
};

export type SafetyPause = { reason: string; resumeAt: Date | null };

const RESTRICTION_RE = /RESTRICT|DISABLE|BAN|VIOLATION/i;

export function safetyCheck(input: SafetyInput): SafetyPause | null {
  const { settings } = input;
  const now = input.now ?? new Date();

  const window = input.recent.slice(0, settings.failRateWindow);
  if (window.length >= settings.failRateWindow) {
    const failed = window.filter((r) => r.failed).length;
    const pct = (failed / window.length) * 100;
    if (pct >= settings.failRatePercent) {
      return {
        reason: `Pausa de seguridad: fallaron ${failed} de los últimos ${window.length} envíos (${Math.round(pct)} %, el tope es ${settings.failRatePercent} %). Revisa la base y los motivos antes de reanudar.`,
        resumeAt: null,
      };
    }
  }

  if (settings.pauseOnQualityRed && input.quality?.toUpperCase() === "RED") {
    return {
      reason: "Pausa de seguridad: Meta calificó el número con calidad BAJA (roja). Seguir enviando puede bajar tu límite.",
      resumeAt: null,
    };
  }

  const ev = input.accountEvent;
  if (ev) {
    const kind = typeof ev.event === "string" ? ev.event : "";
    if (RESTRICTION_RE.test(kind) || "restriction_info" in ev) {
      return {
        reason: `Pausa de seguridad: Meta envió un aviso de restricción de la cuenta (${kind || "restricción"}). Revísalo en el Administrador de WhatsApp.`,
        resumeAt: null,
      };
    }
  }

  if (input.limit !== null && input.limit > 0) {
    const threshold = (input.limit * settings.usagePausePercent) / 100;
    if (input.usage >= threshold) {
      return {
        reason: `Pausa de seguridad: van ${input.usage.toLocaleString("es-MX")} de ${input.limit.toLocaleString("es-MX")} destinatarios en 24 h (${settings.usagePausePercent} % del límite). Se reintenta sola cuando se libere la ventana.`,
        resumeAt: new Date(now.getTime() + USAGE_RETRY_MS),
      };
    }
  }
  return null;
}
