import { apiError, withAuth } from "@/lib/api";
import { consentFromForm } from "@/server/contacts-io/consent-form";
import { readCsvForm } from "@/server/contacts-io/csv-form";
import { importContacts } from "@/server/contacts-io/import";
import { IMPORT_ERROR_STATUS, ImportError } from "@/server/contacts-io/validate";

export const dynamic = "force-dynamic";

/**
 * 021 — Importa contactos desde un CSV (multipart: `file`, `tagName?`,
 * `createLeads?`, `consentAnswer` yes|unknown, `optOutTreatment?`
 * respect|opt_in|desconocido — distinto de "respect" pide
 * `contacts.consent_override`). Responde el resumen con el detalle por fila
 * de lo que no entró; nunca un "falló" genérico.
 */
export const POST = withAuth(
  async (session, req: Request) => {
    const csv = await readCsvForm(req);
    if (!csv.ok) return csv.response;
    const consent = consentFromForm(session, csv.form);
    if (!consent.ok) return consent.response;
    const tagName = String(csv.form.get("tagName") ?? "").trim() || null;
    const createLeads = String(csv.form.get("createLeads") ?? "") === "true";

    try {
      const summary = await importContacts({
        organizationId: session.organizationId,
        actorUserId: session.userId,
        fileName: csv.fileName,
        text: csv.text,
        tagName,
        createLeads,
        consentAnswer: consent.answer,
        optOutTreatment: consent.treatment,
      });
      return Response.json({ summary });
    } catch (err) {
      if (err instanceof ImportError) {
        return apiError(IMPORT_ERROR_STATUS[err.code], err.code, err.message);
      }
      throw err;
    }
  },
  { permission: "contacts.import" }
);
