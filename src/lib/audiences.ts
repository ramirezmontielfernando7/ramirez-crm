import type { OptOutPreview } from "@/lib/import-consent";

/**
 * Campañas v2 (PR 2) — Contrato compartido de Audiencias (cliente y
 * servidor): las bases .xlsx/.csv que se suben desde Campañas → Audiencias.
 */

/** Campos que una columna del archivo puede llenar. */
export type ImportColumn = "name" | "phone" | "source" | "waConsent" | "waConsentSource" | "tags" | "email";

export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  "name",
  "phone",
  "email",
  "tags",
  "source",
  "waConsent",
  "waConsentSource",
];

/** Para el paso "¿qué es cada columna?". */
export const IMPORT_COLUMN_LABEL: Record<ImportColumn, string> = {
  name: "Nombre",
  phone: "Número de WhatsApp",
  email: "Correo",
  tags: "Etiquetas",
  source: "Fuente",
  waConsent: "Consentimiento",
  waConsentSource: "Origen del consentimiento",
};

export const AUDIENCE_MAX_MB = 5;
export const AUDIENCE_ACCEPT = ".xlsx,.csv";

/** Cómo obtuvo el negocio el consentimiento de una base (declaración). */
export const CONSENT_ORIGINS = [
  "Formulario en mi sitio web",
  "Lo pidieron en mi tienda o punto de venta",
  "Me escribieron por WhatsApp primero",
  "Casilla en un contrato o registro",
] as const;

export type AudienceCounts = {
  totalRows: number;
  created: number;
  updated: number;
  invalid: number;
  duplicate: number;
  empty: number;
  members: number;
  /** Consentimiento de los miembros AL IMPORTAR (bases anteriores no los traen). */
  consentOptIn?: number;
  consentOptOut?: number;
  consentUnknown?: number;
  reactivated?: number;
  toUnknown?: number;
};

export type AudienceDto = {
  id: string;
  name: string;
  fileName: string;
  fileKind: "csv" | "xlsx";
  consentSource: string;
  columns: string[];
  counts: AudienceCounts;
  /** Miembros HOY por consentimiento (cambia si alguien se da de baja). */
  consent: { optIn: number; optOut: number; unknown: number };
  tag: { id: string; name: string } | null;
  failuresCount: number;
  createdAt: string;
};

export type PreviewRow = {
  line: number;
  cells: string[];
  /** Motivo si la fila NO entra; null si entra. */
  error: string | null;
  duplicate: boolean;
  /** Salvedad (p. ej. correo inválido ignorado). */
  warning: string | null;
};

export type AudiencePreviewDto = {
  fileKind: "csv" | "xlsx";
  header: string[];
  /** Índice de columna por campo (la reconocida o la elegida). */
  mapping: Partial<Record<ImportColumn, number>>;
  /** Campos obligatorios sin columna: hay que preguntar "¿qué es cada columna?". */
  missing: ImportColumn[];
  extraColumns: string[];
  /** Primeras filas, con las inválidas marcadas. */
  sample: PreviewRow[];
  summary: { totalRows: number; valid: number; invalid: number; duplicate: number; empty: number; warnings: number } | null;
  /** Contactos del archivo que ya pidieron no recibir mensajes. */
  optOut: OptOutPreview;
};
