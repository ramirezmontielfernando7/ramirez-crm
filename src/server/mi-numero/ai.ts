import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isPaused } from "@/lib/direct-send";
import { logger } from "@/lib/log";
import { logActivitySafe } from "@/server/activity/log";
import { getDirectConnection } from "@/server/credentials/direct-instance";
import { publish } from "@/server/events/bus";
import { getOrgModules } from "@/server/modules";
import { isOrgActive } from "@/server/platform-admin/org-status";
import { numberAudience } from "./audience";

const log = logger("mi-numero");

/**
 * Mi número (046), PR 8 — «La IA contesta mis chats» (el 4.º interruptor).
 *
 * - Solo en chats marcados «Es cliente» de un número con el interruptor
 *   encendido. Lo privado jamás llega a la IA.
 * - `conversation.ai_enabled` de un chat de número es un REFLEJO de esas dos
 *   cosas (`syncNumberAi`): el turno del agente (`pipeline.ts`) lo lee como
 *   en cualquier chat y se calla si está apagado.
 * - Cuando la persona escribe (desde Dashfort o desde su celular), la IA se
 *   pausa en ESE chat (`handoff_at`, como en la Bandeja); la reanuda ella.
 * - La respuesta sale por el dispositivo del número, nunca por Meta ni por el
 *   de la empresa: `numberAiRoute` lo decide y `inbox/send.ts` lo manda.
 */

/** Vuelve a calcular el reflejo de la IA en los chats de un número. */
export async function syncNumberAi(organizationId: string, directNumberId: string): Promise<void> {
  const [number] = await getDb()
    .select({ aiReplies: schema.directNumber.aiReplies })
    .from(schema.directNumber)
    .where(scoped(schema.directNumber.organizationId, organizationId, eq(schema.directNumber.id, directNumberId)))
    .limit(1);
  if (!number) return;
  await getDb()
    .update(schema.conversation)
    .set({
      aiEnabled: number.aiReplies ? sql`${schema.conversation.clientMarkedAt} is not null` : false,
      updatedAt: new Date(),
    })
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.directNumberId, directNumberId)));
}

/** Por dónde sale un texto de la IA: el chat de la empresa (lo de siempre), un número, o no sale. */
export type NumberAiRoute =
  | { kind: "company" }
  | { kind: "blocked"; message: string }
  | { kind: "number"; scope: { directNumberId: string; audience: string[] } };

export async function numberAiRoute(organizationId: string, conversationId: string): Promise<NumberAiRoute> {
  const [row] = await getDb()
    .select({ conversation: schema.conversation, number: schema.directNumber })
    .from(schema.conversation)
    .leftJoin(schema.directNumber, eq(schema.directNumber.id, schema.conversation.directNumberId))
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  if (!row || row.conversation.directNumberId === null) return { kind: "company" };
  const { conversation, number } = row;
  if (!number || number.revokedAt) return { kind: "blocked", message: "Este número ya no está en Dashfort." };
  if (conversation.isTest) return { kind: "blocked", message: "Conversación de prueba: el envío real está prohibido." };
  if (!(await isOrgActive(organizationId))) return { kind: "blocked", message: "La organización no está activa." };
  const modules = await getOrgModules(organizationId);
  if (!modules.miNumero || !modules.conexionDirecta) return { kind: "blocked", message: "«Mi número» está apagado para esta empresa." };
  if (!number.aiReplies || !conversation.clientMarkedAt)
    return { kind: "blocked", message: "La IA solo contesta chats de cliente con «La IA contesta mis chats» encendido." };
  const connection = await getDirectConnection(organizationId, number.id);
  if (!connection || connection.status !== "connected") return { kind: "blocked", message: "El número no está conectado." };
  if (isPaused(connection, new Date())) return { kind: "blocked", message: "El número está en pausa de emergencia." };
  return { kind: "number", scope: { directNumberId: number.id, audience: await numberAudience(organizationId, number) } };
}

/** ¿Le toca a la IA contestar este mensaje que acaba de entrar? (sin tocar nada) */
export function aiShouldAnswer(
  number: { aiReplies: boolean },
  conversation: { clientMarkedAt: Date | null; aiEnabled: boolean; handoffAt: Date | null; isTest: boolean }
): boolean {
  return number.aiReplies && !!conversation.clientMarkedAt && conversation.aiEnabled && !conversation.handoffAt && !conversation.isTest;
}

/**
 * La persona escribió en este chat: la IA se hace a un lado (una vez; atómico).
 * No hace nada si la IA no estaba contestando.
 */
export async function pauseAiOnHumanReply(organizationId: string, conversationId: string): Promise<boolean> {
  const [paused] = await getDb()
    .update(schema.conversation)
    .set({ handoffAt: new Date(), handoffReason: "manual_reply", updatedAt: new Date() })
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        and(
          eq(schema.conversation.id, conversationId),
          isNotNull(schema.conversation.directNumberId),
          eq(schema.conversation.aiEnabled, true),
          isNull(schema.conversation.handoffAt)
        )
      )
    )
    .returning({ contactId: schema.conversation.contactId });
  if (!paused) return false;
  await logActivitySafe({ organizationId, contactId: paused.contactId, kind: "ai_handoff", source: "sistema", detail: { reason: "manual_reply" } });
  log.info("la persona escribió en su número: IA pausada en ese chat", { org: organizationId, conversacion: conversationId });
  return true;
}

/** Avisa a quien se entera de un número que algo cambió en este chat (p. ej. la IA se pausó). */
export async function notifyNumberChat(organizationId: string, conversationId: string): Promise<void> {
  const [row] = await getDb()
    .select({ userId: schema.directNumber.userId, kind: schema.directNumber.kind })
    .from(schema.conversation)
    .innerJoin(schema.directNumber, eq(schema.directNumber.id, schema.conversation.directNumberId))
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  if (!row) return;
  publish(organizationId, { type: "number.conversation", data: { conversationId }, audience: await numberAudience(organizationId, row) });
}
