import { apiError, forbidden } from "@/lib/api";
import { can } from "@/lib/auth/permissions";
import type { SessionContext } from "@/lib/auth/session";
import {
  parseConsentAnswer,
  parseOptOutTreatment,
  type ConsentAnswer,
  type OptOutTreatment,
} from "@/lib/import-consent";

/**
 * La declaración de consentimiento y el tratamiento de las bajas, leídos del
 * formulario de una importación (Contactos y Audiencias). Sin respuesta no se
 * importa; un tratamiento que no sea "respetar" pide
 * `contacts.consent_override` (Propietario y Coordinador) — en el SERVIDOR,
 * aunque la interfaz ya no se lo ofrezca a quien no lo tiene.
 */
export function consentFromForm(
  session: Pick<SessionContext, "role" | "grants">,
  form: FormData
): { ok: true; answer: ConsentAnswer; treatment: OptOutTreatment } | { ok: false; response: Response } {
  const answer = parseConsentAnswer(form.get("consentAnswer"));
  if (!answer) {
    return {
      ok: false,
      response: apiError(
        422,
        "consent_required",
        "Indica si estos contactos aceptaron recibir mensajes de WhatsApp de tu empresa"
      ),
    };
  }
  const rawTreatment = form.get("optOutTreatment");
  const treatment = rawTreatment === null || rawTreatment === "" ? "respect" : parseOptOutTreatment(rawTreatment);
  if (!treatment) {
    return { ok: false, response: apiError(422, "invalid_treatment", "Tratamiento de bajas no válido") };
  }
  if (treatment !== "respect" && !can(session, "contacts.consent_override")) {
    return { ok: false, response: forbidden() };
  }
  return { ok: true, answer, treatment };
}
