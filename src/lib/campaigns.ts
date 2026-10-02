/**
 * 021 — Contrato compartido de campañas (cliente y servidor).
 */

/** Cómo se llena cada {{n}} de la plantilla. */
export type CampaignVariable =
  | { kind: "fixed"; value: string }
  /** El nombre de pila del destinatario ("Hola {{1}}" → "Hola Ana"). */
  | { kind: "contact_name" }
  /** Campañas v2: una columna extra de la base subida ("cupón"). */
  | { kind: "column"; column: string };

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";
/**
 * `sending` = un despachador lo reclamó y está hablando con Meta; `skipped`
 * = no se le envió por una regla (se dio de baja, se archivó, ya no existe).
 */
export type RecipientStatus = "pending" | "sending" | "sent" | "failed" | "skipped";

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Borrador",
  scheduled: "Programada",
  sending: "Enviando",
  paused: "En pausa",
  completed: "Terminada",
  cancelled: "Cancelada",
  failed: "Detenida",
};

export const RECIPIENT_STATUS_LABEL: Record<RecipientStatus, string> = {
  pending: "Pendiente",
  sending: "Enviando",
  sent: "Enviado",
  failed: "Falló",
  skipped: "Omitido",
};

/**
 * Público de una campaña. El consentimiento NO es elegible: siempre opt_in.
 * Campañas v2: `importId` = una base guardada de Audiencias (si viene, manda
 * sobre etiquetas y fuente).
 */
export type CampaignAudience = {
  tagIds?: string[];
  source?: string;
  importId?: string;
};

/** Por qué alguien del público NO recibirá la campaña. */
export type ExclusionReason = "noConsent" | "optOut" | "invalid" | "duplicate" | "archived" | "missingVariable";

export const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  noConsent: "Sin consentimiento (opt_in)",
  optOut: "Pidieron no recibir mensajes (opt_out)",
  invalid: "Número inválido",
  duplicate: "Duplicados",
  archived: "Archivados",
  missingVariable: "Sin valor para una variable",
};

export type CampaignPreview = {
  eligible: number;
  excluded: Record<ExclusionReason, number>;
  /** Costo ESTIMADO (tarifa capturada × destinatarios); null sin tarifa. */
  estimate: { amount: number; currency: string | null } | null;
  /** Límite de 24 h leído de Meta (null = ilimitado o sin lectura) y uso estimado. */
  limit: number | null;
  usage: number;
  /** Cuántos más caben hoy en el límite; null si no hay límite conocido. */
  margin: number | null;
  /** Categoría de la plantilla (para la tarifa). */
  category: string | null;
};

export type CampaignCounts = { pending: number; sending: number; sent: number; failed: number; skipped: number };

export function emptyCounts(): CampaignCounts {
  return { pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };
}

/**
 * Campañas v2 — estado REAL de entrega, derivado del mensaje de cada
 * destinatario (`campaign_recipient.message_id → message`), no copiado. Lo
 * actualiza el webhook de estados de Meta.
 */
export type DeliveryStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  pending: "Enviando",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "No entregado",
};

/** Conteo por estado de entrega: `delivered` incluye a los leídos. */
export type CampaignDelivery = { delivered: number; read: number; failed: number };

export type CampaignDto = {
  id: string;
  name: string;
  status: CampaignStatus;
  template: { id: string; name: string; language: string; body: string; category: string } | null;
  variables: CampaignVariable[];
  audience: CampaignAudience;
  total: number;
  counts: CampaignCounts;
  delivery: CampaignDelivery;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Campañas v2 (PR 2). */
  scheduledAt: string | null;
  pauseReason: string | null;
  autoPaused: boolean;
  resumeAt: string | null;
  /** Costo ESTIMADO al lanzar; null sin tarifa capturada. */
  estimatedCost: number | null;
  costCurrency: string | null;
  excluded: Partial<Record<ExclusionReason, number>> | null;
  testSentAt: string | null;
  /** Nombre de la base guardada, si el público es una. */
  audienceName: string | null;
};

export type CampaignRecipientDto = {
  id: string;
  contactId: string | null;
  contactName: string;
  phone: string | null;
  status: RecipientStatus;
  errorMessage: string | null;
  sentAt: string | null;
  /** Estado real del mensaje en WhatsApp; null si nunca salió. */
  delivery: {
    status: DeliveryStatus;
    deliveredAt: string | null;
    readAt: string | null;
    error: string | null;
  } | null;
};

/** Primer nombre, para saludar sin sonar a base de datos ("Ana", no "ANA MARÍA LÓPEZ"). */
export function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  if (!first) return "";
  // Solo se "arregla" un nombre en MAYÚSCULAS o minúsculas completas.
  if (first === first.toUpperCase() || first === first.toLowerCase()) {
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }
  return first;
}

/**
 * Los valores concretos de {{1}}…{{n}} para un destinatario. Una columna sin
 * valor queda vacía: quien llama decide (el lanzamiento lo excluye).
 */
export function resolveVariables(
  vars: CampaignVariable[],
  contactName: string,
  fields: Record<string, string> = {}
): string[] {
  return vars.map((v) =>
    v.kind === "fixed"
      ? v.value
      : v.kind === "column"
        ? (fields[v.column] ?? "").trim()
        : firstName(contactName) || "cliente"
  );
}

/**
 * Campañas v2 (PR 2) — Ajustes de envío de la organización: pausa de
 * seguridad y tarifas ESTIMADAS (las captura el negocio; no son de Meta).
 */
export type CampaignSettingsDto = {
  /** Pausa si los fallos llegan a este % de los últimos `failRateWindow` intentos. */
  failRatePercent: number;
  /** Intentos que se miran (y mínimo para decidir). */
  failRateWindow: number;
  /** Pausa si Meta califica el número en ROJO. */
  pauseOnQualityRed: boolean;
  /** Pausa (y reintenta sola) al llegar a este % del límite de 24 h. */
  usagePausePercent: number;
  /** Costo estimado por mensaje: { marketing?, utility?, authentication? }. */
  rates: Record<string, number>;
  currency: string | null;
  /** Horas tras el envío en que un mensaje del contacto cuenta como respuesta (Métricas). */
  replyWindowHours: number;
};

export const RATE_CATEGORY_LABEL: Record<string, string> = {
  marketing: "Marketing",
  utility: "Utilidad",
  authentication: "Autenticación",
};
