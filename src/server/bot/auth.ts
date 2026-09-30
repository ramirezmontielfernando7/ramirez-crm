import { apiError } from "@/lib/api";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { markBotSeen } from "@/server/bot/status";
import { resolveBotKey, touchBotKey } from "@/server/bot/keys";

/**
 * Autenticación de la API de servicio `/api/bot/*`.
 *
 * Esta superficie NO la consume el navegador: la consume un cerebro externo
 * (un microservicio propio del operador, en su mismo servidor) que quiere
 * conducir la conversación sin que el token de WhatsApp salga del CRM.
 *
 * Fase 1 multitenant (H2): header `X-API-Key` contra `bot_api_key` (hash
 * SHA-256). La LLAVE dice la organización: cada ruta opera solo sobre la
 * organización de la llave, nunca sobre "la de la instancia". Una
 * organización sin llave activa responde 401 (apagado por defecto).
 *
 * Primero se autentica y DESPUÉS se cuenta. Antes había un solo cubo global
 * contado antes de mirar la key: 600 requests anónimos por minuto dejaban al
 * cerebro en 429 el resto de la ventana, y los clientes sin respuesta.
 */

/**
 * Presupuesto del cerebro AUTENTICADO, por organización: 1200/min (20/s
 * sostenidos). Nea hace ~4-10 llamadas por turno de cliente (contexto,
 * "escribiendo…", 1-3 mensajes y, cuando aplica, ficha, handoff, agenda o
 * adjuntos): alcanza para 120-300 turnos por minuto, por encima del pico de
 * un solo negocio. Un cerebro desbocado en un bucle queda en 20/s, carga que
 * el monolito absorbe sin que la bandeja lo note — y sin gastarse el
 * presupuesto de otra organización.
 */
export const BOT_API_BUDGET = { windowMs: 60_000, max: 1200 };

/**
 * Autenticaciones FALLIDAS por IP: 30/min, y luego 429. Jamás tocan el
 * presupuesto de arriba, y una key correcta pasa aunque su IP esté frenada:
 * detrás del mismo proxy (o sin proxy, donde todo es "local") el cerebro puede
 * compartir IP con quien inunda. Adivinar la key tampoco es el riesgo: mide
 * 16+ caracteres.
 */
export const BOT_AUTH_FAILURES = { windowMs: 60_000, max: 30 };

export type BotAuth =
  | { ok: true; organizationId: string }
  | { ok: false; response: Response };

export async function requireBotKey(req: Request): Promise<BotAuth> {
  const key = await resolveBotKey(req.headers.get("x-api-key"));
  if (!key) {
    const ip = clientIp(req.headers);
    const fails = checkRateLimit(`bot-api-fail:${ip}`, BOT_AUTH_FAILURES);
    return {
      ok: false,
      response: fails.allowed
        ? apiError(401, "unauthorized", "No autorizado")
        : apiError(429, "rate_limited", "Demasiados intentos fallidos"),
    };
  }
  // «Quién responde»: la única huella que deja el cerebro externo en el CRM,
  // por organización. Se marca al autenticar, antes del presupuesto: un
  // cerebro frenado por 429 sigue siendo el que contesta.
  markBotSeen(key.organizationId);
  await touchBotKey(key.keyId, key.organizationId);
  const rl = checkRateLimit(`bot-api:${key.organizationId}`, BOT_API_BUDGET);
  if (!rl.allowed) {
    return { ok: false, response: apiError(429, "rate_limited", "Demasiadas solicitudes") };
  }
  return { ok: true, organizationId: key.organizationId };
}
