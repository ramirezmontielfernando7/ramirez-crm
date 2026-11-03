import type { WebhookPayload, WebhookValue } from "@/server/inbox/webhook";
import { processEchoesValue, processMessagesValue } from "@/server/inbox/ingest";
import { processTemplateStatusValue } from "@/server/whatsapp/template-events";
import {
  processHistoryValue,
  processStateSyncValue,
  type HistoryValue,
  type StateSyncValue,
} from "@/server/whatsapp/coexistence";
import { isWabaField, processWabaEvent } from "@/server/whatsapp/waba-events";
import { logger } from "@/lib/log";

const log = logger("webhook");

/**
 * Procesa un evento de WhatsApp (Meta) ya firmado y guardado en la bandeja
 * durable (DF-03). Cada cambio va por separado: si uno falla, los demás del
 * mismo lote se procesan igual y al final se lanza, para que la bandeja lo
 * reintente. Reintentar es seguro: todo es idempotente (mensajes por
 * `wa_message_id`, estados monotónicos).
 */
export async function processWhatsAppPayload(payload: WebhookPayload): Promise<void> {
  let failures = 0;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (!change.value) continue;
      try {
        await processChange(entry.id ?? null, change.field, change.value);
      } catch (err) {
        failures++;
        log.error("error procesando un cambio del webhook (se reintentará)", { campo: change.field, err });
      }
    }
  }
  if (failures > 0) throw new Error(`${failures} cambio(s) del webhook no se pudieron procesar`);
}

async function processChange(entryId: string | null, field: string | undefined, value: WebhookValue): Promise<void> {
  if (field === "messages") {
    await processMessagesValue(value);
  } else if (field === "smb_message_echoes") {
    // 008: mensajes enviados a mano desde la app del teléfono (coexistence)
    await processEchoesValue(value);
  } else if (field === "history") {
    // Tech Provider (coexistencia): chats de los últimos 6 meses.
    await processHistoryValue(value as HistoryValue);
  } else if (field === "smb_app_state_sync") {
    // Tech Provider (coexistencia): contactos del celular.
    await processStateSyncValue(value as StateSyncValue);
  } else if (field === "message_template_status_update") {
    await processTemplateStatusValue(entryId, value);
  } else if (isWabaField(field)) {
    // Campañas v2: salud del número, avisos de la cuenta y cambio de
    // categoría de plantillas (a nivel WABA).
    await processWabaEvent(field, entryId, value as Record<string, unknown>);
  }
  // otros fields: ignorar sin error
}
