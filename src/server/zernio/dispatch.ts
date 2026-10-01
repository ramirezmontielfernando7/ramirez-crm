import type { Channel } from "@/lib/channels";
import { someOrgHasChannel } from "@/server/channels/enabled";
import { processZernioEvent } from "@/server/instagram/ingest";
import { getZernioWebhookSecret } from "@/server/credentials/resolve";
import { processZernioMessengerEvent } from "@/server/messenger/ingest";
import { parseZernioEvent, type ZernioEvent } from "@/server/zernio";
import { logger } from "@/lib/log";

const log = logger("zernio");

/**
 * 017 — Reparto de un evento de Zernio al canal que le toca.
 *
 * Zernio entrega TODAS las plataformas conectadas a esa llave por UN solo
 * webhook: el que se dé de alta recibe los DMs de Instagram y los mensajes de
 * la página de Facebook por igual. Si cada canal solo atendiera su propia URL,
 * quien tenga el webhook apuntado a `/api/webhooks/ig/...` vería sus mensajes
 * de Messenger descartados en silencio — el peor modo de fallo posible, porque
 * el webhook responde 200 y no hay nada que investigar.
 *
 * Así que ambas rutas de Zernio reparten por `account.platform`, y da igual
 * cuál de las dos URLs esté configurada.
 */

/** A qué canal pertenece un evento, o null si no es de ninguno nuestro. */
export function zernioTargetChannel(payload: unknown): Channel | null {
  const evt = payload as ZernioEvent | null;
  if (!evt || typeof evt !== "object") return null;
  const platform = (evt.account?.platform ?? "").toLowerCase();
  if (platform === "instagram") return "instagram";
  if (platform === "facebook" || platform === "messenger") return "messenger";
  return null;
}

/**
 * El secreto de firma de la cuenta que manda el evento, buscándolo en el canal
 * que corresponda. Se resuelve ANTES de procesar, leyendo solo el cuerpo: la
 * firma se valida contra el secreto de ESA cuenta, no uno global.
 */
export async function resolveZernioSecret(
  rawBody: string
): Promise<{ secret: string | null; accountRef: string | null; channel: Channel | null }> {
  const evt = parseZernioEvent(rawBody);
  const accountRef = evt?.account?.id ?? null;
  const channel = zernioTargetChannel(evt);
  if (!accountRef) return { secret: null, accountRef: null, channel };

  if (channel !== "messenger" && channel !== "instagram") return { secret: null, accountRef, channel };

  // Fase 3: cuenta desconocida, sin secreto guardado o secreto ilegible →
  // `secret: null`, y la ruta RECHAZA (401): sin secreto no hay firma que
  // verificar, y aceptar sin firma deja inyectar DMs a quien sepa la URL.
  const found = await getZernioWebhookSecret(channel, accountRef);
  if (!found.ok) {
    if (found.error !== "unknown_account") {
      log.error("no se pudo abrir el secreto de webhook de Zernio", { cuenta: accountRef, code: found.error });
    }
    return { secret: null, accountRef, channel };
  }
  if (!found.secret) {
    log.warn("cuenta de Zernio sin secreto de webhook: evento rechazado (401). Pega el secreto en Ajustes", { org: found.organizationId, canal: channel });
  }
  return { secret: found.secret, accountRef, channel };
}

/**
 * Procesa el evento por el canal al que pertenece. Un canal que ninguna
 * organización tiene descarta con aviso (ADR-001); si alguna lo tiene, la
 * ingesta vuelve a preguntar por la organización dueña de la cuenta.
 */
export async function processZernioPayload(payload: unknown): Promise<void> {
  const channel = zernioTargetChannel(payload);
  if (!channel) return; // otra plataforma conectada a la misma llave: no es nuestra

  if (!(await someOrgHasChannel(channel))) {
    log.warn("evento con el canal apagado en todas las organizaciones: descartado", { canal: channel });
    return;
  }

  if (channel === "messenger") await processZernioMessengerEvent(payload);
  else await processZernioEvent(payload);
}
