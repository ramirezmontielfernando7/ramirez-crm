import type { Channel } from "@/lib/channels";
import { anyOrgHasChannel, orgChannels, orgHasChannel } from "@/server/modules";

/**
 * 014 — Qué canales están encendidos en esta instancia.
 *
 * El código de todos los canales viaja siempre en main; lo que decide si
 * existen para el usuario es la variable `CHANNELS`. Una instalación normal
 * (`CHANNELS=whatsapp`, el default) no ve Instagram por ningún lado: ni
 * pantalla, ni webhook, ni variables que llenar.
 *
 * Se hace así, y no con una rama por feature, porque una rama tiene que
 * mantenerse compatible con main Y con las demás ramas opcionales, y su
 * cadena de migraciones diverge sin arreglo posible. Con la bandera hay UNA
 * cadena de migraciones para todo el mundo y los conflictos los resuelve el
 * autor una vez, no cada usuario en cada actualización.
 *
 * La migración se aplica siempre: una columna con default y una tabla vacía
 * son inertes, y a cambio todas las instancias tienen la misma estructura.
 */

export { parseChannels } from "@/server/modules/defaults";

/**
 * Fase 3, PR 3 — Por ORGANIZACIÓN (`organization_module`); la variable
 * `CHANNELS` queda como valor por defecto (src/server/modules/).
 */
export async function enabledChannels(organizationId: string): Promise<ReadonlySet<Channel>> {
  return orgChannels(organizationId);
}

/**
 * ¿Alguna organización tiene este canal? Lo usan las URLs de webhook, que son
 * de la PLATAFORMA (una sola para todas): si nadie lo tiene, no existen (404).
 * Después de enrutar, la ingesta vuelve a preguntar por la organización.
 */
export async function someOrgHasChannel(channel: Channel): Promise<boolean> {
  return anyOrgHasChannel(channel);
}

export async function isChannelEnabled(organizationId: string, channel: Channel): Promise<boolean> {
  return orgHasChannel(organizationId, channel);
}

/**
 * Respuesta para una superficie de un canal apagado. 404 y no 403 a
 * propósito: si el canal no está encendido, ese endpoint no existe en esta
 * instancia — no hay nada que revelar sobre él.
 */
export function channelDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
