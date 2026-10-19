import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * 041 — Marca el chat como «pendiente de la campaña» justo antes de enviarle
 * la plantilla, SOLO si el contacto nunca ha escrito (`last_inbound_at`
 * NULL; misma regla que `campaignKeepsPending`). Atómico: un entrante que
 * llega a la vez gana (la ingesta pone `last_inbound_at` y suelta la marca).
 *
 * Varias campañas a un chat sin respuesta: queda la más reciente.
 *
 * Devuelve true si el chat queda en «Campañas»: el envío entonces no publica
 * eventos en vivo a la Bandeja.
 */
export async function markCampaignPending(
  organizationId: string,
  conversationId: string,
  campaignId: string
): Promise<boolean> {
  const rows = await getDb()
    .update(schema.conversation)
    .set({ campaignPendingId: campaignId })
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        and(
          eq(schema.conversation.id, conversationId),
          eq(schema.conversation.isTest, false),
          isNull(schema.conversation.lastInboundAt)
        )
      )
    )
    .returning({ id: schema.conversation.id });
  return rows.length > 0;
}
