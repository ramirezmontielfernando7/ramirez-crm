import { withAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { enabledChannels } from "@/server/channels/enabled";
import { isPlatformOrg, platformOrgId } from "@/server/platform";
import type { WebhookSettingsDto } from "@/lib/webhook-settings";

export const dynamic = "force-dynamic";

/**
 * Datos del webhook para pegar en Meta o en el backend de la agencia (FR-043).
 *
 * Los canales opcionales comparten el segmento secreto y el verify token, pero
 * cada uno tiene su ruta: Meta configura el webhook de Messenger y el de
 * Instagram por separado (productos distintos de la misma app), así que aquí
 * viajan las tres URLs y la pantalla de cada canal enseña la suya. Las de un
 * canal apagado van en null: no existen en esta instancia (ADR-001).
 *
 * Fase 1 multitenant (H7): el token (y la URL, que lo lleva en la ruta) es
 * un secreto de la PLATAFORMA — con Tech Provider hay una sola app de Meta y
 * un solo webhook para todas las organizaciones. Solo lo recibe la
 * organización `PLATFORM_ORG_ID`. Las demás ven que lo administra la
 * plataforma. Sin la variable no lo ve nadie (`platformConfigMissing`):
 * jamás se adivina con "la primera organización".
 */
export const GET = withAuth(async (session) => {
  const env = getEnv();
  const signatureLayer = Boolean(env.META_APP_SECRET);
  if (!isPlatformOrg(session.organizationId)) {
    const dto: WebhookSettingsDto = {
      managedByPlatform: true,
      platformConfigMissing: platformOrgId() === null,
      signatureLayer,
    };
    return Response.json(dto);
  }
  const base = env.APP_BASE_URL.replace(/\/$/, "");
  const channels = await enabledChannels(session.organizationId);
  const url = `${base}/api/webhooks/wa/${env.META_WEBHOOK_VERIFY_TOKEN}`;
  const dto: WebhookSettingsDto = {
    managedByPlatform: false,
    platformConfigMissing: false,
    url,
    instagramUrl: channels.has("instagram")
      ? `${base}/api/webhooks/ig/${env.META_WEBHOOK_VERIFY_TOKEN}`
      : null,
    messengerUrl: channels.has("messenger")
      ? `${base}/api/webhooks/messenger/${env.META_WEBHOOK_VERIFY_TOKEN}`
      : null,
    verifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
    isHttps: url.startsWith("https://"),
    signatureLayer,
  };
  return Response.json(dto);
}, { permission: "settings.manage" });
