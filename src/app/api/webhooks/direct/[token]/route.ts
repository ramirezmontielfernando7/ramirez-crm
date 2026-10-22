import { after } from "next/server";
import { parseDeviceMessages } from "@/lib/direct-inbound";
import { logger } from "@/lib/log";
import { ingestDeviceMessages, organizationForWebhook } from "@/server/direct-connection/inbound";
import { handleWebhookState } from "@/server/direct-connection/link";
import { parseState } from "@/server/direct-connection/evolution-api";
import { handleWebhookStatuses } from "@/server/direct-connection/status";
import { parseDirectStatusUpdates } from "@/lib/direct-echo";
import { acceptsWebhooks, beginTask } from "@/server/shutdown";

export const dynamic = "force-dynamic";

const log = logger("direct-connection");

type Params = { params: Promise<{ token: string }> };

/**
 * Conexión directa (PR 2) — El aviso de estado del dispositivo vinculado. El
 * token de la URL (de un solo uso por organización; en la base solo su hash)
 * decide de quién es. Un token que no existe responde 404 sin efectos. Se
 * lee el estado del dispositivo (`connection.update`) y, desde el PR 4, las
 * palomitas de lo enviado (`messages.update`) y, desde el PR 6, los mensajes
 * (`messages.upsert`: solo cuentan en una empresa sin Meta); lo demás se
 * ignora.
 */
export async function POST(req: Request, { params }: Params) {
  const { token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token)) return new Response(null, { status: 404 });
  if (!acceptsWebhooks()) return new Response(null, { status: 503, headers: { "Retry-After": "5" } });
  let body: { event?: unknown; data?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const event = typeof body.event === "string" ? body.event.toLowerCase().replace(/_/g, ".") : "";
  if (event === "messages.update") {
    try {
      const known = await handleWebhookStatuses(token, parseDirectStatusUpdates(body.data));
      return new Response(null, { status: known ? 200 : 404 });
    } catch (err) {
      log.error("no se pudieron aplicar las palomitas del dispositivo vinculado", { err });
      return new Response(null, { status: 500 });
    }
  }
  if (event === "messages.upsert") {
    let organizationId: string | null;
    try {
      organizationId = await organizationForWebhook(token);
    } catch (err) {
      log.error("no se pudo leer el aviso de mensajes del dispositivo vinculado", { err });
      return new Response(null, { status: 500 });
    }
    if (!organizationId) return new Response(null, { status: 404 });
    const messages = parseDeviceMessages(body.data);
    if (messages.length === 0) return new Response(null, { status: 200 });
    // Como el webhook de Meta: se responde ya y se registra después (unir la
    // copia de un envío puede esperar a que el dispositivo conteste).
    const task = beginTask("webhook:direct");
    after(async () => {
      try {
        await ingestDeviceMessages(organizationId, messages);
      } catch (err) {
        log.error("error registrando mensajes del dispositivo vinculado", { err });
      } finally {
        task.end();
      }
    });
    return new Response(null, { status: 200 });
  }
  if (event !== "connection.update") return new Response(null, { status: 200 });
  const state = parseState(body.data);
  if (!state) return new Response(null, { status: 200 });
  try {
    const known = await handleWebhookState(token, state);
    return new Response(null, { status: known ? 200 : 404 });
  } catch (err) {
    log.error("no se pudo aplicar el aviso del dispositivo vinculado", { err });
    return new Response(null, { status: 500 });
  }
}
