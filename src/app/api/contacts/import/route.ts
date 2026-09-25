import { apiError, withAuth } from "@/lib/api";
import { importContacts } from "@/server/contacts-io/import";
import { decodeCsvBytes, IMPORT_MAX_BYTES, ImportError } from "@/server/contacts-io/validate";

export const dynamic = "force-dynamic";

const IMPORT_ERROR_STATUS: Record<ImportError["code"], number> = {
  too_large: 413,
  empty: 422,
  malformed: 422,
  missing_columns: 422,
  too_many_rows: 413,
  not_csv: 415,
};

const MB = (IMPORT_MAX_BYTES / 1024 / 1024).toFixed(0);

/**
 * 021 — Importa contactos desde un CSV (multipart: `file`, `tagName?`,
 * `createLeads?`). Responde el resumen con el detalle por fila de lo que no
 * entró; nunca un "falló" genérico.
 */
export const POST = withAuth(
  async (session, req: Request) => {
    // Primer filtro barato: si el navegador ya dice que pesa de más, no se lee.
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > IMPORT_MAX_BYTES + 64 * 1024) {
      return apiError(413, "too_large", `El archivo pesa más de ${MB} MB: divídelo en varios`);
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return apiError(422, "invalid_body", "Sube el archivo como formulario (campo `file`)");
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return apiError(422, "missing_file", "Falta el archivo CSV (campo `file`)");
    }
    if (file.size === 0) return apiError(422, "empty", "El archivo está vacío");
    if (file.size > IMPORT_MAX_BYTES) {
      return apiError(413, "too_large", `El archivo pesa más de ${MB} MB: divídelo en varios`);
    }
    const fileName = (file.name || "archivo.csv").slice(0, 120);
    if (!/\.(csv|txt)$/i.test(fileName)) {
      return apiError(415, "not_csv", `"${fileName}" no es un CSV: exporta tu hoja como .csv`);
    }
    const tagName = String(form.get("tagName") ?? "").trim() || null;
    const createLeads = String(form.get("createLeads") ?? "") === "true";

    try {
      const text = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
      const summary = await importContacts({
        organizationId: session.organizationId,
        actorUserId: session.userId,
        fileName,
        text,
        tagName,
        createLeads,
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
