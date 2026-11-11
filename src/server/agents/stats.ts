import { and, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { companyChat, scopedContacts, type Access } from "@/lib/db/tenant";

/**
 * Ronda 3 — Números de «Mis agentes» (solo lectura): por agente, los chats
 * que la IA contestó en los últimos 7 días y cuántos se resolvieron sin pasar
 * a una persona; y el total contra la semana anterior. El chat sin agente
 * anotado (antes de 031 o del cerebro externo) cuenta para el general, igual
 * que en la auditoría del asistente (`assistant/audit.ts`). Las respuestas de
 * los datos de ejemplo (`wamid.demo.*`) no cuentan (auditoría UX 2026-11, B).
 */
export type AgentStatsDto = {
  perAgent: Record<string, { chats: number; resolved: number }>;
  /** Chats sin agente anotado: se suman al general en la pantalla. */
  unassigned: { chats: number; resolved: number };
  totals: { chats: number; previousChats: number; handedOff: number };
};

const DAY = 86_400_000;

export async function agentStats(access: Access, now = new Date()): Promise<AgentStatsDto> {
  const since = new Date(now.getTime() - 7 * DAY);
  const before = new Date(now.getTime() - 14 * DAY);
  const c = schema.conversation;
  const repliedIn = (from: Date, to: Date) => sql`exists (
    select 1 from message m
    where m.conversation_id = ${c.id} and m.direction = 'out' and m.ai_generated = true
      and (m.wa_message_id is null or m.wa_message_id not like 'wamid.demo.%')
      and m.created_at >= ${from.toISOString()}::timestamp and m.created_at < ${to.toISOString()}::timestamp
  )`;
  const thisWeek = repliedIn(since, now);
  const lastWeek = repliedIn(before, since);
  const handed = sql`${c.handoffAt} is not null and ${c.handoffAt} >= ${since.toISOString()}::timestamp`;

  const rows = await getDb()
    .select({
      agentId: c.lastAgentId,
      chats: sql<number>`count(*) filter (where ${thisWeek})::int`,
      handed: sql<number>`count(*) filter (where ${thisWeek} and ${handed})::int`,
      previous: sql<number>`count(*) filter (where ${lastWeek})::int`,
    })
    .from(c)
    .where(scopedContacts(c.organizationId, access, c.contactId, and(companyChat(), gte(c.lastMessageAt, before))))
    .groupBy(c.lastAgentId);

  const out: AgentStatsDto = { perAgent: {}, unassigned: { chats: 0, resolved: 0 }, totals: { chats: 0, previousChats: 0, handedOff: 0 } };
  for (const r of rows) {
    const chats = Number(r.chats);
    const handedOff = Number(r.handed);
    const entry = { chats, resolved: chats - handedOff };
    if (r.agentId) out.perAgent[r.agentId] = entry;
    else out.unassigned = entry;
    out.totals.chats += chats;
    out.totals.handedOff += handedOff;
    out.totals.previousChats += Number(r.previous);
  }
  return out;
}
