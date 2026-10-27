import { apiError } from "@/lib/api";
import { DirectSendFailure } from "@/server/direct-connection/send";
import { MediaValidationError } from "@/server/whatsapp/media";

const STATUS: Record<DirectSendFailure["code"], number> = { not_connected: 409, meta_error: 422, meta_unavailable: 503 };

/**
 * Mi número (046), PR 5 — Lo que responde la API cuando un envío por el
 * número no sale. Lo demás (incluido `MiNumeroFailure`) sigue hacia `answer`.
 */
export function numberSendError(err: unknown): Response {
  if (err instanceof MediaValidationError) return apiError(err.code === "too_large" ? 413 : 415, err.code, err.message);
  if (err instanceof DirectSendFailure) return apiError(STATUS[err.code], err.code, err.message);
  throw err;
}
