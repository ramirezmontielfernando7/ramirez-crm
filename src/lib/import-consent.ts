/**
 * Consentimiento al importar (Contactos → Importar y Campañas → Audiencias).
 * Contrato compartido de cliente y servidor.
 *
 * - La persona DECLARA si los contactos del archivo aceptaron recibir
 *   WhatsApp: "Sí, todos aceptaron" → `opt_in`; "No lo sé" → `desconocido`.
 *   Una columna de consentimiento con valor en la fila manda sobre la
 *   declaración.
 * - Quien ya pidió no recibir mensajes (`opt_out`) se respeta salvo que la
 *   persona elija otro tratamiento, y eso solo con el permiso
 *   `contacts.consent_override` (Propietario y Coordinador).
 */

export type ConsentAnswer = "yes" | "unknown";

export const CONSENT_ANSWERS: readonly ConsentAnswer[] = ["yes", "unknown"];

export const CONSENT_QUESTION = "¿Estos contactos aceptaron recibir mensajes de WhatsApp de tu empresa?";

export const CONSENT_ANSWER_LABEL: Record<ConsentAnswer, string> = {
  yes: "Sí, todos aceptaron",
  unknown: "No lo sé o no tengo certeza",
};

/** Origen que queda en cada contacto marcado `opt_in` por la declaración. */
export const DECLARED_CONSENT_SOURCE = "declarado al importar";

/** Qué hacer con los contactos del archivo que YA tienen `opt_out`. */
export type OptOutTreatment = "respect" | "opt_in" | "desconocido";

export const OPT_OUT_TREATMENTS: readonly OptOutTreatment[] = ["respect", "opt_in", "desconocido"];

export const OPT_OUT_TREATMENT_LABEL: Record<OptOutTreatment, string> = {
  respect: "Respetar su baja (se actualizan, pero quedan fuera de campañas)",
  opt_in: "Cambiarlos a «acepta mensajes» (queda registrado quién, cuándo y por qué)",
  desconocido: "Cambiarlos a «sin confirmar» (ni incluidos ni excluidos)",
};

/** Un contacto del archivo que ya pidió no recibir mensajes. */
export type OptOutConflict = {
  line: number;
  name: string;
  /** Teléfono del contacto o, si no tiene, su identidad de WhatsApp. */
  phone: string;
  /** Desde cuándo (ISO) o null si nunca se registró la fecha. */
  since: string | null;
  source: string | null;
};

export type OptOutPreview = {
  count: number;
  /** Hasta `OPT_OUT_PREVIEW_MAX` filas, para la tabla y su descarga. */
  rows: OptOutConflict[];
};

export const OPT_OUT_PREVIEW_MAX = 5_000;

/** Cómo quedaron los contactos del archivo tras importar. */
export type ImportConsentResult = {
  optIn: number;
  optOut: number;
  unknown: number;
  /** De `opt_out` a `opt_in` por el tratamiento elegido. */
  reactivated: number;
  /** De `opt_out` a `desconocido` por el tratamiento elegido. */
  toUnknown: number;
};

export function parseConsentAnswer(value: unknown): ConsentAnswer | null {
  return typeof value === "string" && (CONSENT_ANSWERS as readonly string[]).includes(value)
    ? (value as ConsentAnswer)
    : null;
}

export function parseOptOutTreatment(value: unknown): OptOutTreatment | null {
  return typeof value === "string" && (OPT_OUT_TREATMENTS as readonly string[]).includes(value)
    ? (value as OptOutTreatment)
    : null;
}

/** Encabezados y filas del CSV descargable de contactos con baja. */
export function optOutCsvRows(rows: OptOutConflict[]): { header: string[]; rows: string[][] } {
  return {
    header: ["linea", "nombre", "telefono", "baja_desde", "origen_de_la_baja"],
    rows: rows.map((r) => [String(r.line), r.name, r.phone, r.since ? r.since.slice(0, 10) : "", r.source ?? ""]),
  };
}
