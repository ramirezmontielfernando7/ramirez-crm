/**
 * 021 — Contrato compartido de campañas (cliente y servidor).
 */

/** Cómo se llena cada {{n}} de la plantilla. */
export type CampaignVariable =
  | { kind: "fixed"; value: string }
  /** El nombre de pila del destinatario ("Hola {{1}}" → "Hola Ana"). */
  | { kind: "contact_name" };

export type CampaignStatus = "draft" | "sending" | "completed" | "failed";
export type RecipientStatus = "pending" | "sent" | "failed";

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Borrador",
  sending: "Enviando",
  completed: "Terminada",
  failed: "Detenida",
};

export const RECIPIENT_STATUS_LABEL: Record<RecipientStatus, string> = {
  pending: "Pendiente",
  sent: "Enviado",
  failed: "Falló",
};

/** Público de una campaña. El consentimiento NO es elegible: siempre opt_in. */
export type CampaignAudience = {
  tagIds?: string[];
  source?: string;
};

export type CampaignCounts = { pending: number; sent: number; failed: number };

export type CampaignDto = {
  id: string;
  name: string;
  status: CampaignStatus;
  template: { id: string; name: string; language: string; body: string } | null;
  variables: CampaignVariable[];
  audience: CampaignAudience;
  total: number;
  counts: CampaignCounts;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type CampaignRecipientDto = {
  id: string;
  contactId: string | null;
  contactName: string;
  phone: string | null;
  status: RecipientStatus;
  errorMessage: string | null;
  sentAt: string | null;
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

/** Los valores concretos de {{1}}…{{n}} para un destinatario. */
export function resolveVariables(vars: CampaignVariable[], contactName: string): string[] {
  return vars.map((v) =>
    v.kind === "fixed" ? v.value : firstName(contactName) || "cliente"
  );
}
