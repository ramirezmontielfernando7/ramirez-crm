import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { publish } from "@/server/events/bus";
import { logActivitySafe } from "@/server/activity/log";
import { toHandoffReason } from "@/server/bot/handoff";
import { announceHandoff } from "@/server/inbox/handoff-notice";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  /**
   * Texto libre a propósito: el catálogo se aplica después, con fallback
   * (ver `server/bot/handoff`). Un motivo raro no puede costar el handoff.
   */
  reason: z.string().optional(),
});

/**
 * Handoff pedido por el cerebro externo: pausa la IA y deja la conversación
 * para un humano. Idempotente — solo escribe en la transición, así que
 * reintentar no pisa la hora ni el motivo original.
 *
 * Es la misma pausa que el toggle de la bandeja, y publica el mismo evento,
 * así que la app lo ve en vivo sin refrescar.
 */
export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const rows = await db
    .select({
      id: schema.conversation.id,
      contactId: schema.conversation.contactId,
      handoffAt: schema.conversation.handoffAt,
    })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  const conv = rows[0];
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");

  if (!conv.handoffAt) {
    await db
      .update(schema.conversation)
      .set({
        aiEnabled: false,
        handoffAt: new Date(),
        handoffReason: toHandoffReason(body.data.reason),
        updatedAt: new Date(),
      })
      .where(eq(schema.conversation.id, conv.id));
    publish(organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: conv.id } },
    });
    // 026: el aviso (asignado + quien ve todo; no participantes).
    await announceHandoff(organizationId, conv.id, toHandoffReason(body.data.reason));
    // 022: queda en la línea de tiempo del chat.
    await logActivitySafe({
      organizationId,
      contactId: conv.contactId,
      kind: "ai_handoff",
      source: "api",
      detail: { reason: toHandoffReason(body.data.reason) },
    });
  }
  return Response.json({ ok: true });
}
