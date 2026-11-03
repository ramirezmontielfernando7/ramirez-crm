import { after } from "next/server";
import { getEnv, isMockEnabled } from "@/lib/env";
import {
  checkWhatsAppSignature,
  isValidWebhookToken,
  MISSING_SECRET_REJECT_WARNING,
  type WebhookPayload,
} from "@/server/inbox/webhook";
import { enqueueWebhookEvent, processSoon } from "@/server/webhooks/inbox";
import { logger } from "@/lib/log";
import { acceptsWebhooks } from "@/server/shutdown";

const log = logger("webhook");

/**
 * Webhook público de WhatsApp (contrato webhook.md).
 * Capa 1: el segmento [webhookToken] debe coincidir (si no → 404 sin efectos).
 * Capa 2 (H7, obligatoria): firma x-hub-signature-256 con META_APP_SECRET.
 * Sin firma válida → 401. Sin META_APP_SECRET → 401 a todo evento y un aviso
 * en el log; la única excepción es desarrollo con los mocks
 * (`isMockEnabled()`: WA_MOCK_ENABLED=true y NODE_ENV ≠ production).
 * DF-03: tras validar, el evento se GUARDA (cifrado) en la bandeja durable y
 * solo entonces se responde 200; si no se pudo guardar, 500 y Meta reintenta.
 * El procesamiento va en after() y, si falla, lo reintenta el trabajador de
 * fondo (`src/server/webhooks/inbox.ts`).
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };

export async function GET(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response(null, { status: 403 });
}

export async function POST(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }
  // Operación 1: apagándose y sin tiempo para procesarlo → 503 y la fuente
  // lo reintenta (le llega al contenedor nuevo). Nunca un 200 sin procesar.
  if (!acceptsWebhooks()) {
    return new Response(null, { status: 503, headers: { "Retry-After": "5" } });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const check = checkWhatsAppSignature(rawBody, signature, env.META_APP_SECRET, {
    allowUnsignedDev: isMockEnabled(),
  });
  if (!check.ok) {
    if (check.reason === "missing_secret") warnMissingSecret();
    return new Response(null, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    // body ilegible: 200 igualmente (Meta reintenta y termina desactivando)
    return Response.json({ received: true });
  }

  let id: string | null;
  try {
    id = await enqueueWebhookEvent("whatsapp", payload);
  } catch (err) {
    // Sin guardarlo no se acusa: Meta lo reintenta.
    log.error("no se pudo guardar el evento del webhook: se responde 500 para que Meta lo reintente", { err });
    return new Response(null, { status: 500 });
  }
  // null: el mismo evento ya estaba guardado (reintento de Meta); lo procesa
  // quien lo guardó o el trabajador.
  if (id) processSoon(id, after);

  return Response.json({ received: true });
}

/**
 * Aviso de rechazo por falta de META_APP_SECRET: a lo más uno por minuto
 * (Meta reintenta cada evento; sin esto el log se inunda).
 */
const MISSING_SECRET_WARN_EVERY_MS = 60_000;
let lastMissingSecretWarnAt = 0;
function warnMissingSecret(): void {
  const now = Date.now();
  if (now - lastMissingSecretWarnAt < MISSING_SECRET_WARN_EVERY_MS) return;
  lastMissingSecretWarnAt = now;
  log.warn(MISSING_SECRET_REJECT_WARNING);
}
