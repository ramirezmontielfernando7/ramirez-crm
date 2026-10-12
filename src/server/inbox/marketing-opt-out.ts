import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { logger } from "@/lib/log";
import { logActivitySafe } from "@/server/activity/log";

const log = logger("baja");

/**
 * 038 (PR 6) — Baja de MARKETING que avisa Meta (error 131050: «el usuario
 * dejó de recibir mensajes de marketing de esta empresa» desde WhatsApp).
 *
 * No es un `opt_out`: la persona sigue aceptando utilidad y autenticación, y
 * `wa_consent` no se toca. Se guarda en `contact.wa_marketing_opt_out_at` y
 * desde ahí las campañas de MARKETING la omiten (`audience.ts` al armar el
 * público y el despachador justo antes de enviar).
 *
 * Llega por dos caminos y los dos pasan por aquí: la respuesta del envío
 * (síncrona, `dispatcher.ts`) y el estado `failed` del webhook (asíncrona,
 * `status.ts`). Idempotente: solo la primera vez escribe y anota en la línea
 * de tiempo. Nunca lanza: un fallo aquí no tumba el envío ni el webhook.
 */
export const MARKETING_OPT_OUT_CODE = 131050;

export async function markMarketingOptOut(input: {
  organizationId: string;
  contactId: string;
  at?: Date;
}): Promise<boolean> {
  try {
    const at = input.at ?? new Date();
    const updated = await getDb()
      .update(schema.contact)
      .set({ waMarketingOptOutAt: at, updatedAt: new Date() })
      .where(
        scoped(
          schema.contact.organizationId,
          input.organizationId,
          and(eq(schema.contact.id, input.contactId), isNull(schema.contact.waMarketingOptOutAt))
        )
      )
      .returning({ id: schema.contact.id });
    if (updated.length === 0) return false;
    await logActivitySafe({
      organizationId: input.organizationId,
      contactId: input.contactId,
      kind: "marketing_opt_out",
      source: "sistema",
      detail: { action: "set", code: String(MARKETING_OPT_OUT_CODE) },
      occurredAt: at,
    });
    return true;
  } catch (err) {
    log.error("no se pudo guardar la baja de marketing (131050)", { org: input.organizationId, err });
    return false;
  }
}

/** La baja de marketing del contacto de una conversación (el webhook solo trae el mensaje). */
export async function markMarketingOptOutForConversation(input: {
  organizationId: string;
  conversationId: string;
  at?: Date;
}): Promise<boolean> {
  try {
    const rows = await getDb()
      .select({ contactId: schema.conversation.contactId, isTest: schema.conversation.isTest })
      .from(schema.conversation)
      .where(scoped(schema.conversation.organizationId, input.organizationId, eq(schema.conversation.id, input.conversationId)))
      .limit(1);
    const c = rows[0];
    if (!c || c.isTest) return false;
    return markMarketingOptOut({ organizationId: input.organizationId, contactId: c.contactId, at: input.at });
  } catch (err) {
    log.error("no se pudo ubicar el contacto de la baja de marketing (131050)", { org: input.organizationId, err });
    return false;
  }
}

/**
 * Una persona confirma que el contacto volvió a aceptar promociones. Si Meta
 * sigue respondiendo 131050, la marca vuelve sola en el siguiente envío.
 */
export async function clearMarketingOptOut(input: {
  organizationId: string;
  contactId: string;
  actorUserId: string;
}): Promise<boolean> {
  const updated = await getDb()
    .update(schema.contact)
    .set({ waMarketingOptOutAt: null, updatedAt: new Date() })
    .where(
      scoped(
        schema.contact.organizationId,
        input.organizationId,
        and(eq(schema.contact.id, input.contactId), isNotNull(schema.contact.waMarketingOptOutAt))
      )
    )
    .returning({ id: schema.contact.id });
  if (updated.length === 0) return false;
  await logActivitySafe({
    organizationId: input.organizationId,
    contactId: input.contactId,
    kind: "marketing_opt_out",
    actorUserId: input.actorUserId,
    source: "usuario",
    detail: { action: "cleared" },
  });
  return true;
}
