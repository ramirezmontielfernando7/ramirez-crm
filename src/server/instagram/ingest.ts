import { IG_PREFIX } from "@/server/inbox/identity";
import { ingestInboundMessage } from "@/server/inbox/ingest";
import {
  resolveInstagramByAccountRef,
  resolveInstagramByIgUserId,
} from "@/server/credentials/resolve";
import { recordUnrouted, unroutedReasonFor } from "@/server/webhooks/unrouted";
import { zernioSentAtSeconds, type ZernioEvent } from "@/server/zernio";
import { logger } from "@/lib/log";

const log = logger("ig");

/**
 * 014 — Adaptadores de entrada del canal de Instagram.
 *
 * Dos fuentes con formatos que no se parecen en nada: Zernio manda un evento
 * plano y Meta manda `entry[].messaging[]` al estilo Messenger. Cada una se
 * normaliza aquí y de ahí en adelante corre el MISMO núcleo de ingesta que ya
 * resuelve contacto, conversación, idempotencia y bus de eventos.
 */

/**
 * 017: la verificación de la firma vive en `server/zernio` porque la comparten
 * todos los canales que entran por esa API. Se re-exporta para no tocar a
 * quien ya la importaba de aquí.
 */
export { isValidZernioSignature } from "@/server/zernio";

export async function processZernioEvent(payload: unknown): Promise<void> {
  const evt = payload as ZernioEvent;

  // El mismo webhook trae WhatsApp, Facebook y X si esas cuentas estan
  // conectadas: sin este filtro acabariamos ingiriendo otra plataforma como
  // si fueran DMs de Instagram.
  if (evt.account?.platform !== "instagram") return;
  if (evt.event !== "message.received") return;
  if (evt.message?.direction && evt.message.direction !== "incoming") return;

  const accountRef = evt.account?.id;
  if (!accountRef) return;

  const creds = await resolveInstagramByAccountRef(accountRef);
  if (!creds) {
    log.warn("evento para una cuenta desconocida: guarda la conexión en Configuración → Instagram para recibir mensajes", { cuenta: accountRef });
    return;
  }
  if (creds.orgStatus !== "active") {
    await recordUnrouted({ source: "instagram", routeKind: "account_ref", routeKey: accountRef, field: "message.received", payload: evt, reason: unroutedReasonFor(creds.orgStatus) });
    return;
  }

  if (creds.source !== "zernio") {
    // Defensa en profundidad: esta instancia no habla con Zernio, asi que un
    // payload con su forma no puede ser legitimo aunque llegue por la URL
    // correcta. Sin esto, la unica barrera de la forma ajena es la URL.
    log.warn("payload de Zernio con la conexión configurada en otro origen: descartado", { org: creds.organizationId, origen: creds.source });
    return;
  }

  const igsid = evt.message?.sender?.id;
  if (!igsid) {
    log.warn("evento sin sender.id: descartado", { org: creds.organizationId, evento: evt.id ?? "?" });
    return;
  }

  const text = evt.message?.text ?? null;
  // Id de Zernio, no el de la plataforma (el payload trae los dos): es el
  // que se mantiene entre reentregas, que es lo que hay que colapsar.
  const zernioMessageId = evt.message?.id;
  if (!zernioMessageId) {
    log.warn("evento sin id de mensaje: descartado", { org: creds.organizationId, evento: evt.id ?? "?" });
    return;
  }

  await ingestInboundMessage({
    organizationId: creds.organizationId,
    identity: {
      identity: `${IG_PREFIX}${igsid}`,
      channel: "instagram",
      phone: null,
      waUserId: null,
      profileName:
        evt.message?.sender?.name ??
        (evt.message?.sender?.username
          ? `@${evt.message.sender.username}`
          : null),
    },
    // Prefijado para que no colisione jamas con un id de WhatsApp en el
    // indice unico de mensajes.
    waMessageId: `ig_${zernioMessageId}`,
    type: "text",
    text,
    timestamp: zernioSentAtSeconds(evt.message?.sentAt),
    threadRef: evt.message?.conversationId ?? null,
  });
}

type MetaIgPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    messaging?: Array<{
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
      };
    }>;
  }>;
};

export async function processMetaInstagramPayload(
  payload: unknown
): Promise<void> {
  const body = payload as MetaIgPayload;
  if (body.object !== "instagram") return;

  for (const entry of body.entry ?? []) {
    const igUserId = entry.id;
    if (!igUserId) continue;

    const creds = await resolveInstagramByIgUserId(igUserId);
    if (!creds) {
      // Firmado por Meta pero de un perfil que nadie conectó: se guarda 7 días.
      await recordUnrouted({ source: "instagram", routeKind: "ig_user_id", routeKey: igUserId, field: "messaging", payload: entry });
      continue;
    }
    if (creds.orgStatus !== "active") {
      await recordUnrouted({ source: "instagram", routeKind: "ig_user_id", routeKey: igUserId, field: "messaging", payload: entry, reason: unroutedReasonFor(creds.orgStatus) });
      continue;
    }
    if (creds.source !== "meta") {
      // Idem: sin app propia de Meta, un payload con su forma no puede venir
      // de Meta. Cierra la inyeccion en instancias que solo usan Zernio, donde
      // META_APP_SECRET no existe y la firma no se puede verificar.
      log.warn("payload de Meta con la conexión configurada en otro origen: descartado", { org: creds.organizationId, origen: creds.source });
      continue;
    }

    for (const m of entry.messaging ?? []) {
      // Los echos son mensajes que el dueno mando desde la app de Instagram.
      // Fuera del alcance del 014: se ignoran sin ruido.
      if (m.message?.is_echo) continue;

      const igsid = m.sender?.id;
      const mid = m.message?.mid;
      if (!igsid || !mid) continue;
      if (typeof m.message?.text !== "string") continue; // solo texto (014)

      await ingestInboundMessage({
        organizationId: creds.organizationId,
        identity: {
          identity: `${IG_PREFIX}${igsid}`,
          channel: "instagram",
          phone: null,
          waUserId: null,
          // Meta no manda nombre ni usuario en el webhook: queda el respaldo
          // hasta que alguien edite el contacto.
          profileName: null,
        },
        waMessageId: `ig_${mid}`,
        type: "text",
        text: m.message.text,
        timestamp: String(
          m.timestamp ? Math.floor(m.timestamp / 1000) : Math.floor(Date.now() / 1000)
        ),
        threadRef: null,
      });
    }
  }
}
