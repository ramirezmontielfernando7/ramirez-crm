import { apiError } from "@/lib/api";
import { decodeCsvBytes, IMPORT_MAX_BYTES } from "@/server/contacts-io/validate";

const MB = (IMPORT_MAX_BYTES / 1024 / 1024).toFixed(0);

/**
 * 021 — Lee el CSV de Contactos → Importar (multipart, campo `file`) con los
 * mismos topes para la vista previa y para la importación.
 */
export async function readCsvForm(
  req: Request
): Promise<{ ok: true; form: FormData; fileName: string; text: string } | { ok: false; response: Response }> {
  const fail = (status: number, code: string, message: string) => ({
    ok: false as const,
    response: apiError(status, code, message),
  });
  // Primer filtro barato: si el navegador ya dice que pesa de más, no se lee.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > IMPORT_MAX_BYTES + 64 * 1024) {
    return fail(413, "too_large", `El archivo pesa más de ${MB} MB: divídelo en varios`);
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(422, "invalid_body", "Sube el archivo como formulario (campo `file`)");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(422, "missing_file", "Falta el archivo CSV (campo `file`)");
  if (file.size === 0) return fail(422, "empty", "El archivo está vacío");
  if (file.size > IMPORT_MAX_BYTES) {
    return fail(413, "too_large", `El archivo pesa más de ${MB} MB: divídelo en varios`);
  }
  const fileName = (file.name || "archivo.csv").slice(0, 120);
  if (!/\.(csv|txt)$/i.test(fileName)) {
    return fail(415, "not_csv", `"${fileName}" no es un CSV: exporta tu hoja como .csv`);
  }
  return { ok: true, form, fileName, text: decodeCsvBytes(new Uint8Array(await file.arrayBuffer())) };
}
