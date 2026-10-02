import { z } from "zod";
import { apiError } from "@/lib/api";
import { SOURCE_FILTER_VALUES } from "@/server/contact-filter";
import { CAMPAIGN_ERROR_STATUS, CampaignError } from "@/server/campaigns/service";
import { AudienceError } from "@/server/campaigns/audiences";
import { IMPORT_ERROR_STATUS, ImportError } from "@/server/contacts-io/validate";

/** 021 — Piezas HTTP compartidas por las rutas de campañas. */

/**
 * Público elegible. NO hay campo de consentimiento: siempre es opt_in.
 * Campañas v2: `importId` = una base guardada de Audiencias.
 */
export const audienceSchema = z
  .object({
    tagIds: z.array(z.string().min(1)).max(50).optional(),
    source: z.enum(SOURCE_FILTER_VALUES).optional(),
    importId: z.string().min(1).max(64).optional(),
  })
  .strict();

export const variableSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed"), value: z.string().max(500) }),
  z.object({ kind: z.literal("contact_name") }),
  z.object({ kind: z.literal("column"), column: z.string().min(1).max(40) }),
]);

export function campaignErrorResponse(err: unknown): Response {
  if (err instanceof CampaignError) {
    return apiError(CAMPAIGN_ERROR_STATUS[err.code], err.code, err.message);
  }
  if (err instanceof AudienceError) {
    return apiError(err.code === "not_found" ? 404 : 422, err.code, err.message);
  }
  if (err instanceof ImportError) {
    return apiError(IMPORT_ERROR_STATUS[err.code], err.code, err.message);
  }
  throw err;
}

/** El archivo de un formulario multipart, con el tope de tamaño. */
export async function formFile(
  req: Request,
  maxBytes: number
): Promise<{ ok: true; form: FormData; file: File; bytes: Uint8Array } | { ok: false; response: Response }> {
  const mb = (maxBytes / 1024 / 1024).toFixed(0);
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes + 64 * 1024) {
    return { ok: false, response: apiError(413, "too_large", `El archivo pesa más de ${mb} MB: divídelo en varios`) };
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return { ok: false, response: apiError(422, "invalid_body", "Sube el archivo como formulario (campo `file`)") };
  }
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, response: apiError(422, "missing_file", "Falta el archivo (campo `file`)") };
  if (file.size === 0) return { ok: false, response: apiError(422, "empty", "El archivo está vacío") };
  if (file.size > maxBytes) {
    return { ok: false, response: apiError(413, "too_large", `El archivo pesa más de ${mb} MB: divídelo en varios`) };
  }
  return { ok: true, form, file, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/** La asignación de columnas que manda el asistente (JSON en el formulario). */
export function formMapping(form: FormData): unknown {
  const raw = form.get("mapping");
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
