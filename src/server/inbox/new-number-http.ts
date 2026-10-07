import { apiError } from "@/lib/api";
import { SendError } from "@/server/inbox/send";
import { TemplateError, templateErrorStatus } from "@/server/whatsapp/templates";
import { NewNumberError } from "@/server/inbox/new-number";

/** Errores del flujo → respuesta HTTP (los mismos códigos que el envío de plantillas de un chat). */
export function newNumberErrorResponse(err: unknown): Response | null {
  if (err instanceof NewNumberError) return apiError(err.status, err.code, err.message);
  if (err instanceof TemplateError) {
    return apiError(templateErrorStatus(err), err.code, err.message);
  }
  if (err instanceof SendError) return apiError(403, err.code, err.message);
  return null;
}
