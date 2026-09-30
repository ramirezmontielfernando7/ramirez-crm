import type { Channel } from "@/lib/channels";
import { isChannelEnabled } from "@/server/channels/enabled";
import { getInstagramCredentialsByAccountRef } from "@/server/instagram/credentials";
import { processZernioEvent } from "@/server/instagram/ingest";
import { getMessengerCredentialsByAccountRef } from "@/server/messenger/credentials";
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

  const creds =
    channel === "messenger"
      ? await getMessengerCredentialsByAccountRef(accountRef)
      : channel === "instagram"
        ? await getInstagramCredentialsByAccountRef(accountRef)
        : null;

  return { secret: creds?.webhookSecret ?? null, accountRef, channel };
}

/**
 * Procesa el evento por el canal al que pertenece. Un canal apagado descarta
 * con aviso: la instancia no lo tiene, y su superficie no existe (ADR-001).
 */
export async function processZernioPayload(payload: unknown): Promise<void> {
  const channel = zernioTargetChannel(payload);
  if (!channel) return; // otra plataforma conectada a la misma llave: no es nuestra

  if (!isChannelEnabled(channel)) {
    log.warn("evento con el canal apagado en esta instancia: descartado", { canal: channel });
    return;
  }

  if (channel === "messenger") await processZernioMessengerEvent(payload);
  else await processZernioEvent(payload);
}
