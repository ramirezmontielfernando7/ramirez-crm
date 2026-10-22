import { apiError } from "@/lib/api";
import { logger } from "@/lib/log";
import { lookupOpenRouterPrices } from "@/server/costs/models";
import { withPlatformAdmin } from "@/server/platform-admin/http";

export const dynamic = "force-dynamic";

/**
 * Trae de OpenRouter (lista pública de modelos, sin llave) el precio de los
 * modelos en uso, para rellenar el formulario. POST porque es una llamada
 * saliente que solo ocurre cuando el administrador pulsa el botón. No guarda
 * nada: el administrador revisa y guarda con `POST /api/platform/pricing`.
 */
export const POST = withPlatformAdmin(async () => {
  try {
    const prices = await lookupOpenRouterPrices();
    if (!prices) return apiError(422, "not_openrouter", "El proveedor configurado no es OpenRouter: sus precios no se pueden traer por API.");
    return Response.json({ prices });
  } catch (err) {
    logger("costos").warn("no se pudo leer la lista de modelos de OpenRouter", { err });
    return apiError(502, "provider_error", "No se pudo consultar OpenRouter. Intenta de nuevo o captura los precios a mano.");
  }
});
