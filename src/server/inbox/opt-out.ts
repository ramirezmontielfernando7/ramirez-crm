import { and, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { logger } from "@/lib/log";
import { matchStopKeyword } from "@/lib/opt-out";
import { logActivitySafe } from "@/server/activity/log";
import { publish } from "@/server/events/bus";
import { sendText } from "@/server/inbox/send";
import { getMessagingSettings } from "@/server/messaging-settings";

const log = logger("baja");

/**
 * Campañas v2 (PR 1) — Baja por palabra clave (STOP/BAJA) en la ingesta.
 *
 * Si el mensaje del cliente coincide COMPLETO con una palabra de baja de su
 * organización, el contacto pasa a `opt_out` (pegajoso: ninguna importación
 * lo revierte) y la baja queda en la línea de tiempo. Con eso ya queda fuera
 * de toda campaña futura: el público solo admite `opt_in` (audience.ts) y el
 * ejecutor lo vuelve a comprobar justo antes de cada envío (runner.ts).
 *
 * Solo WhatsApp (el consentimiento `wa_consent` es de ese canal) y nunca en
 * conversaciones del Laboratorio. La respuesta automática es opcional y
 * viene APAGADA por defecto; si falla, la baja ya quedó guardada igual.
 *
 * Devuelve true si el mensaje era una baja: la ingesta entonces no despierta
 * al agente de IA (contestarle con IA a quien pidió no recibir mensajes es
 * justo lo que no quiere).
 */
export async function handleStopKeyword(input: {
  organizationId: string;
  contact: { id: string; channel: string; waConsent: string };
  conversation: { id: string; isTest: boolean };
  text: string | null;
}): Promise<boolean> {
  const { organizationId, contact, conversation } = input;
  if (contact.channel !== "whatsapp" || conversation.isTest || !input.text) return false;

  const settings = await getMessagingSettings(organizationId);
  if (!settings.stopKeywordsEnabled) return false;
  const keyword = matchStopKeyword(input.text, settings.stopKeywords);
  if (!keyword) return false;

  const source = `Pidió la baja por WhatsApp («${keyword}»)`;
  const updated = await getDb()
    .update(schema.contact)
    .set({ waConsent: "opt_out", waConsentSource: source, waConsentAt: new Date(), updatedAt: new Date() })
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        and(eq(schema.contact.id, contact.id), ne(schema.contact.waConsent, "opt_out"))
      )
    )
    .returning({ id: schema.contact.id });

  // Ya estaba dado de baja: no se repite la bitácora ni la respuesta.
  if (updated.length === 0) return true;

  await logActivitySafe({
    organizationId,
    contactId: contact.id,
    kind: "consent_changed",
    source: "sistema",
    detail: { from: contact.waConsent, to: "opt_out", source, keyword },
  });
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversation.id } },
  });

  const reply = settings.stopReplyText?.trim();
  if (settings.stopReplyEnabled && reply) {
    try {
      // El cliente acaba de escribir: la ventana de 24 h está abierta.
      await sendText({ organizationId, conversationId: conversation.id, text: reply });
    } catch (err) {
      log.warn("no se pudo enviar la confirmación de baja (la baja sí quedó guardada)", {
        org: organizationId,
        err,
      });
    }
  }
  return true;
}
