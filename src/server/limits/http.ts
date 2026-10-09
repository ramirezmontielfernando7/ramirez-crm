import { apiError } from "@/lib/api";
import { LimitError } from "./index";

/**
 * 036 (PR 3a) — Corre la comprobación de un tope; si lo pasa, la respuesta
 * lista (413 almacenamiento, 409 personas, 422 módulos) con el mensaje claro
 * para quien intentó crecer. Si no, `null` y la ruta sigue.
 */
export async function limitBlocked(check: () => Promise<void>): Promise<Response | null> {
  try {
    await check();
    return null;
  } catch (err) {
    if (err instanceof LimitError) return apiError(err.status, err.code, err.message);
    throw err;
  }
}
