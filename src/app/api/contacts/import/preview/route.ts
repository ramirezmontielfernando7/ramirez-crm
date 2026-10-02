import { apiError, withAuth } from "@/lib/api";
import { readCsvForm } from "@/server/contacts-io/csv-form";
import { findOptOutConflicts } from "@/server/contacts-io/import";
import { IMPORT_ERROR_STATUS, ImportError, validateImport } from "@/server/contacts-io/validate";

export const dynamic = "force-dynamic";

/**
 * Vista previa de Contactos → Importar SIN escribir nada: cuántas filas
 * entran y cuáles de esos contactos ya pidieron no recibir mensajes (para
 * elegir su tratamiento antes de importar).
 */
export const POST = withAuth(
  async (session, req: Request) => {
    const csv = await readCsvForm(req);
    if (!csv.ok) return csv.response;
    try {
      const v = validateImport(csv.text);
      return Response.json({
        preview: {
          totalRows: v.totalRows,
          valid: v.rows.length,
          failed: v.failures.length,
          emptyRows: v.emptyRows,
          optOut: await findOptOutConflicts(session.organizationId, v.rows),
        },
      });
    } catch (err) {
      if (err instanceof ImportError) {
        return apiError(IMPORT_ERROR_STATUS[err.code], err.code, err.message);
      }
      throw err;
    }
  },
  { permission: "contacts.import" }
);
