import { and, eq, isNull, lt, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { logger } from "@/lib/log";
import { isAiConfigured } from "@/lib/env";
import { AWAY_COOLDOWN_MS, decideAutoReply, fillAutoText } from "@/lib/auto-replies";
import { botLastSeenAt, EXTERNAL_SEEN_WINDOW_MS } from "@/server/bot/status";
import { sendText } from "@/server/inbox/send";
import { getAutoReplySettings } from "@/server/auto-replies/settings";

const log = logger("auto-mensajes");

type ConversationRow = typeof schema.conversation.$inferSelect;
type ContactRow = typeof schema.contact.$inferSelect;

/**
 * 049 — ¿Contestará la IA este chat? Si sí, ella saluda y atiende a cualquier
 * hora: los mensajes automáticos sobran (y se duplicarían). Aproximación
 * barata (sin armar el turno): agente encendido y sin pausa, IA activa en el
 * chat sin traspaso a una persona, o un cerebro externo visto hace poco.
 */
async function aiWillAnswer(organizationId: string, conversation: ConversationRow): Promise<boolean> {
  if (!conversation.aiEnabled || conversation.handoffAt) return false;
  const seen = botLastSeenAt(organizationId);
  if (seen && Date.now() - seen.getTime() < EXTERNAL_SEEN_WINDOW_MS) return true;
  if (!isAiConfigured()) return false;
  const [profile] = await getDb()
    .select({ enabled: schema.agentProfile.enabled, pausedAt: schema.agentProfile.pausedAt })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return !!profile?.enabled && !profile.pausedAt;
}

/**
 * 049 — Mensajes automáticos sin IA, llamado desde la ingesta con el chat TAL
 * COMO ESTABA antes del mensaje que acaba de entrar (`lastInboundAt` viejo).
 *
 * Solo WhatsApp de la empresa, nunca el Laboratorio ni un «Mi número». Cada
 * mensaje se RESERVA con una sola sentencia condicional antes de enviarse
 * (dos mensajes seguidos del cliente no duplican nada). Si el envío falla,
 * se registra y el chat sigue: esto nunca tumba la entrada del mensaje.
 */
export async function maybeSendAutoReply(input: {
  organizationId: string;
  contact: ContactRow;
  conversation: ConversationRow;
  now?: Date;
}): Promise<"welcome" | "away" | null> {
  const { organizationId, contact, conversation } = input;
  const now = input.now ?? new Date();
  if (contact.channel !== "whatsapp" || conversation.channel !== "whatsapp") return null;
  if (conversation.isTest || conversation.directNumberId) return null;
  if (contact.waConsent === "opt_out") return null;
  if (conversation.campaignPendingId) return null;

  const settings = await getAutoReplySettings(organizationId);
  if (!settings.welcomeEnabled && !settings.awayEnabled) return null;

  // ¿Alguien (persona o IA) ya le escribió antes en este chat?
  const [answered] = await getDb()
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        and(eq(schema.message.conversationId, conversation.id), eq(schema.message.direction, "out"), isNull(schema.message.autoKind))
      )
    )
    .limit(1);

  const decision = decideAutoReply({
    now,
    welcome: { enabled: settings.welcomeEnabled, text: settings.welcomeText },
    away: { enabled: settings.awayEnabled, text: settings.awayText },
    hours: settings.hours,
    timezone: settings.timezone,
    firstInbound: conversation.lastInboundAt === null,
    welcomeSentAt: conversation.autoWelcomeAt,
    awaySentAt: conversation.autoAwayAt,
    repliedToCampaign: conversation.campaignRepliedId !== null,
    alreadyAnswered: !!answered,
  });
  if (!decision) return null;
  if (await aiWillAnswer(organizationId, conversation)) return null;

  // Reserva atómica: solo una entrada gana.
  const claimed = await getDb()
    .update(schema.conversation)
    .set(decision.kind === "welcome" ? { autoWelcomeAt: now } : { autoAwayAt: now })
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        and(
          eq(schema.conversation.id, conversation.id),
          decision.kind === "welcome"
            ? isNull(schema.conversation.autoWelcomeAt)
            : or(
                isNull(schema.conversation.autoAwayAt),
                lt(schema.conversation.autoAwayAt, new Date(now.getTime() - AWAY_COOLDOWN_MS))
              )
        )
      )
    )
    .returning({ id: schema.conversation.id });
  if (claimed.length === 0) return null;

  try {
    // El cliente acaba de escribir: la ventana de 24 h está abierta.
    await sendText({
      organizationId,
      conversationId: conversation.id,
      text: fillAutoText(decision.text, contact.name),
      autoKind: decision.kind,
    });
    return decision.kind;
  } catch (err) {
    log.warn("no se pudo enviar el mensaje automático", { org: organizationId, tipo: decision.kind, err });
    return null;
  }
}
