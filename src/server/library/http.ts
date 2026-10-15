import { apiError } from "@/lib/api";
import { withKbDocErrors } from "@/server/kb-docs/http";
import { LimitError } from "@/server/limits";
import { MediaValidationError } from "@/server/whatsapp/media";
import { LibraryError } from "./bridge";

/**
 * 040 — Corre `fn` y traduce los errores de la Biblioteca unificada: los del
 * puente, los de documentos y grupos (`withKbDocErrors`), los topes y los
 * del archivo (límites de WhatsApp).
 */
export async function withLibraryErrors(fn: () => Promise<Response>): Promise<Response> {
  return withKbDocErrors(async () => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof LibraryError) return apiError(err.status, err.code, err.message);
      if (err instanceof LimitError) return apiError(err.status, err.code, err.message);
      if (err instanceof MediaValidationError) {
        return apiError(err.code === "too_large" ? 413 : 415, err.code, err.message);
      }
      throw err;
    }
  });
}
