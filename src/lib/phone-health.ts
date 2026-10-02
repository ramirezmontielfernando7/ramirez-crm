/**
 * Campañas v2 (PR 1) — Reglas puras de la salud del número de WhatsApp.
 * Sin BD ni red: las usan el servidor, la interfaz y las pruebas.
 *
 * Nada aquí fija un límite de Meta: el límite se LEE de Meta (campo crudo
 * como TIER_1K) y solo se traduce a número para comparar el uso del día.
 */

/** "NA" y "UNKNOWN" son sinónimos en la documentación de Meta: sin calificar. */
export type QualityRating = "GREEN" | "YELLOW" | "RED" | "UNKNOWN" | "NA";

export type PhoneHealthSnapshot = {
  day: string;
  qualityRating: string | null;
  messagingLimit: string | null;
  messagingLimitValue: number | null;
  status: string | null;
  throughputLevel: string | null;
  nameStatus: string | null;
  accountEvent: Record<string, unknown> | null;
  source: "sync" | "manual" | "webhook";
  fetchedAt: string;
};

export type HealthAlert = {
  level: "warning" | "danger";
  code: "quality_low" | "quality_dropped" | "number_status" | "account_event" | "usage_near_limit";
  message: string;
};

/**
 * "TIER_250" → 250, "TIER_1K" → 1000, "TIER_100K" → 100000. Ilimitado,
 * vacío o un formato que no se reconoce → null (sin tope conocido: no se
 * inventa uno).
 */
export function parseMessagingLimit(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = /^TIER_(\d+)(K|M)?$/i.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const mult = m[2]?.toUpperCase() === "M" ? 1_000_000 : m[2]?.toUpperCase() === "K" ? 1000 : 1;
  return Number.isFinite(n) && n > 0 ? n * mult : null;
}

export function messagingLimitLabel(raw: string | null | undefined): string {
  if (!raw) return "Sin dato";
  const n = parseMessagingLimit(raw);
  if (n !== null) return `${n.toLocaleString("es-MX")} destinatarios / 24 h`;
  return /UNLIMITED/i.test(raw) ? "Ilimitado" : raw;
}

export const QUALITY_LABEL: Record<string, string> = {
  GREEN: "Alta",
  YELLOW: "Media",
  RED: "Baja",
  UNKNOWN: "Sin calificar",
  NA: "Sin calificar",
};

const QUALITY_RANK: Record<string, number> = { GREEN: 3, YELLOW: 2, RED: 1 };

/** Estados del número con los que se puede enviar sin sobresaltos. */
const OK_STATUSES = new Set(["CONNECTED"]);

/**
 * Las alertas que la app muestra, a partir de la lectura de hoy, la del día
 * anterior y el uso del día. `usageAlertPercent` es configuración de la
 * organización (no de Meta).
 */
export function computeHealthAlerts(input: {
  today: PhoneHealthSnapshot | null;
  previous: PhoneHealthSnapshot | null;
  usage: number;
  usageAlertPercent: number;
  now?: Date;
}): HealthAlert[] {
  const { today, previous } = input;
  const out: HealthAlert[] = [];
  if (!today) return out;
  const q = today.qualityRating?.toUpperCase() ?? null;
  if (q === "RED") {
    out.push({
      level: "danger",
      code: "quality_low",
      message: "La calidad del número es BAJA: Meta puede bajar tu límite de envío. Revisa las plantillas y a quién les escribes.",
    });
  } else if (q === "YELLOW") {
    out.push({
      level: "warning",
      code: "quality_low",
      message: "La calidad del número es MEDIA: vigila las quejas y los bloqueos antes de mandar más campañas.",
    });
  }
  const pq = previous?.qualityRating?.toUpperCase() ?? null;
  if (q && pq && QUALITY_RANK[q] !== undefined && QUALITY_RANK[pq] !== undefined && QUALITY_RANK[q]! < QUALITY_RANK[pq]!) {
    out.push({
      level: q === "RED" ? "danger" : "warning",
      code: "quality_dropped",
      message: `La calidad bajó de ${QUALITY_LABEL[pq] ?? pq} a ${QUALITY_LABEL[q] ?? q} desde la última lectura.`,
    });
  }
  if (today.status && !OK_STATUSES.has(today.status.toUpperCase())) {
    out.push({
      level: "danger",
      code: "number_status",
      message: `Meta reporta el número como «${today.status}». Revísalo en el Administrador de WhatsApp.`,
    });
  }
  if (today.accountEvent) {
    const ev = today.accountEvent;
    const kind = typeof ev.event === "string" ? ev.event : "evento de cuenta";
    out.push({
      level: "danger",
      code: "account_event",
      message: `Meta envió un aviso sobre tu cuenta de WhatsApp Business (${kind}). Revísalo en el Administrador de WhatsApp.`,
    });
  }
  const limit = today.messagingLimitValue;
  if (limit !== null && limit > 0 && input.usage >= (limit * input.usageAlertPercent) / 100) {
    out.push({
      level: input.usage >= limit ? "danger" : "warning",
      code: "usage_near_limit",
      message: `Hoy van ${input.usage.toLocaleString("es-MX")} de ${limit.toLocaleString("es-MX")} destinatarios permitidos en 24 h (${Math.floor((input.usage / limit) * 100)} %).`,
    });
  }
  return out;
}

/** Hoy en UTC como YYYY-MM-DD (la llave de `wa_phone_health.day`). */
export function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
