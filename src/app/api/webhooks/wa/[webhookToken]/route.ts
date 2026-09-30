import { after } from "next/server";
import { getEnv, isMockEnabled } from "@/lib/env";
import {
  checkWhatsAppSignature,
  isValidWebhookToken,
  MISSING_SECRET_REJECT_WARNING,
  type WebhookPayload,
} from "@/server/inbox/webhook";
import { processEchoesValue, processMessagesValue } from "@/server/inbox/ingest";
import { processTemplateStatusValue } from "@/server/whatsapp/template-events";
import { describeError } from "@/lib/log-safe";

/**
 * Webhook público de WhatsApp (contrato webhook.md).
 * Capa 1: el segmento [webhookToken] debe coincidir (si no → 404 sin efectos).
 * Capa 2 (H7, obligatoria): firma x-hub-signature-256 con META_APP_SECRET.
 * Sin firma válida → 401. Sin META_APP_SECRET → 401 a todo evento y un aviso
 * en el log; la única excepción es desarrollo con los mocks
 * (`isMockEnabled()`: WA_MOCK_ENABLED=true y NODE_ENV ≠ production).
 * El POST siempre responde 200 tras validar; el procesamiento va en after().
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

  after(async () => {
    try {
      await processPayload(payload);
    } catch (err) {
      console.error("[webhook] error procesando payload:", describeError(err));
    }
  });

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
  console.warn(MISSING_SECRET_REJECT_WARNING);
}

async function processPayload(payload: WebhookPayload): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (!change.value) continue;
      if (change.field === "messages") {
        await processMessagesValue(change.value);
      } else if (change.field === "smb_message_echoes") {
        // 008: mensajes enviados a mano desde la app del teléfono (coexistence)
        await processEchoesValue(change.value);
      } else if (change.field === "message_template_status_update") {
        await processTemplateStatusValue(entry.id ?? null, change.value);
      }
      // otros fields: ignorar sin error
    }
  }
}
