import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { quarantineString } from "@/lib/assistant-engine";
import { getDb, schema } from "@/lib/db";
import { companyChat, scoped, scopedContacts } from "@/lib/db/tenant";
import { agentsForAudit } from "@/server/agents/store";
import type { QueryContext, QueryOutput } from "./catalog";

/**
 * 0070 — «Audita mis agentes de IA» y «Revisa los chats que contestó la IA»:
 * la consulta `auditoria_agentes` del catálogo del asistente. SOLO LECTURA.
 *
 * Trae (1) cada agente con lo que hoy responde (instrucciones recortadas),
 * (2) cuántos chats contestó cada uno en el periodo, cuántos pasó a una
 * persona y por qué, y (3) unos chats de ejemplo (primero los que terminaron
 * en traspaso) con sus últimos mensajes. Todo de la Bandeja de la EMPRESA
 * (`companyChat()`: ni Laboratorio ni «Mi número»), con `scopedContacts()`.
 * Contactos enmascarados y texto en cuarentena para el modelo.
 */

export const AUDIT_DEFAULT_DAYS = 7;
export const AUDIT_MAX_DAYS = 30;
export const AUDIT_DEFAULT_EXAMPLES = 4;
export const AUDIT_MAX_EXAMPLES = 6;
/** Tope de conversaciones que se cuentan (las más recientes). */
const MAX_CONVERSATIONS = 500;
const MESSAGES_PER_EXAMPLE = 12;

const HANDOFF_LABEL: Record<string, string> = {
  cliente: "el cliente pidió una persona",
  modelo: "el agente decidió pasarlo",
  error: "falló la IA",
  ventana: "se cerró la ventana de 24 h",
  hostilidad: "el cliente se puso agresivo",
  manual_reply: "alguien contestó desde el teléfono",
  cuota: "se acabó el tope de IA",
  pausa: "el agente estaba en pausa",
};

const fmt = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") : null);

export async function auditAgents(ctx: QueryContext, args: { dias: number; ejemplos: number }): Promise<QueryOutput> {
  const db = getDb();
  const since = new Date(ctx.now.getTime() - args.dias * 86_400_000);
  const agents = await agentsForAudit(ctx.organizationId);
  const general = agents.find((a) => a.isGeneral) ?? null;

  const aiReplies = sql<number>`(
    select count(*)::int from message m
    where m.conversation_id = ${schema.conversation.id}
      and m.direction = 'out' and m.ai_generated = true and m.created_at >= ${since.toISOString()}::timestamp
  )`;
  const rows = await db
    .select({
      id: schema.conversation.id,
      agentId: schema.conversation.lastAgentId,
      handoffAt: schema.conversation.handoffAt,
      handoffReason: schema.conversation.handoffReason,
      contacto: schema.contact.name,
      fecha: schema.conversation.lastMessageAt,
      respuestas: aiReplies,
    })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(
      scopedContacts(
        schema.conversation.organizationId,
        ctx.access,
        schema.conversation.contactId,
        and(
          companyChat(),
          isNull(schema.conversation.archivedAt),
          gte(schema.conversation.lastMessageAt, since),
          sql`${aiReplies} > 0`
        )
      )
    )
    .orderBy(desc(schema.conversation.lastMessageAt))
    .limit(MAX_CONVERSATIONS);

  // El chat sin agente anotado (antes de 031 o del cerebro externo) cuenta para el general.
  const keyOf = (agentId: string | null) => agentId ?? general?.id ?? "sin_agente";
  const stats = new Map<string, { chats: number; respuestas: number; traspasos: number; motivos: Record<string, number> }>();
  for (const r of rows) {
    const k = keyOf(r.agentId);
    const s = stats.get(k) ?? { chats: 0, respuestas: 0, traspasos: 0, motivos: {} };
    s.chats += 1;
    s.respuestas += Number(r.respuestas);
    if (r.handoffAt && r.handoffAt >= since) {
      s.traspasos += 1;
      const m = HANDOFF_LABEL[r.handoffReason ?? ""] ?? "otro";
      s.motivos[m] = (s.motivos[m] ?? 0) + 1;
    }
    stats.set(k, s);
  }

  const agentRows = (q: (t: string, max: number) => string) =>
    agents.map((a) => {
      const s = stats.get(a.id) ?? { chats: 0, respuestas: 0, traspasos: 0, motivos: {} };
      return {
        agente: q(a.name, 80),
        general: a.isGeneral,
        estado: a.paused ? "en pausa" : a.status === "draft" ? "borrador (no atiende)" : a.status === "changes" ? "publicado, con cambios sin publicar" : "publicado",
        tono: a.tone ? q(a.tone, 200) : null,
        instrucciones: a.instructions ? q(a.instructions, 1200) : "(sin instrucciones)",
        cuando_pasa_a_persona: a.escalationRules ? q(a.escalationRules, 400) : null,
        chats_contestados: s.chats,
        respuestas_de_ia: s.respuestas,
        pasados_a_persona: s.traspasos,
        motivos_de_traspaso: s.motivos,
      };
    });
  // Chats de un agente que ya no está (archivado) o sin agente anotado: no se pierden.
  const known = new Set(agents.map((a) => a.id));
  const orphan = { chats: 0, respuestas: 0, traspasos: 0, motivos: {} as Record<string, number> };
  for (const [k, s] of stats) {
    if (known.has(k)) continue;
    orphan.chats += s.chats;
    orphan.respuestas += s.respuestas;
    orphan.traspasos += s.traspasos;
    for (const [m, n] of Object.entries(s.motivos)) orphan.motivos[m] = (orphan.motivos[m] ?? 0) + n;
  }
  const orphanRow = orphan.chats
    ? [{ agente: "(agente archivado o sin registrar)", chats_contestados: orphan.chats, respuestas_de_ia: orphan.respuestas, pasados_a_persona: orphan.traspasos, motivos_de_traspaso: orphan.motivos }]
    : [];

  // Ejemplos: primero los que terminaron en traspaso, luego los más recientes.
  const picked = [
    ...rows.filter((r) => r.handoffAt && r.handoffAt >= since),
    ...rows.filter((r) => !(r.handoffAt && r.handoffAt >= since)),
  ].slice(0, args.ejemplos);
  const ids = picked.map((r) => r.id);
  const msgs = ids.length
    ? await db
        .select({
          conversationId: schema.message.conversationId,
          direction: schema.message.direction,
          ai: schema.message.aiGenerated,
          origin: schema.message.origin,
          type: schema.message.type,
          text: schema.message.text,
          at: schema.message.createdAt,
        })
        .from(schema.message)
        .where(scoped(schema.message.organizationId, ctx.organizationId, inArray(schema.message.conversationId, ids)))
        .orderBy(desc(schema.message.createdAt))
    : [];
  const byConv = new Map<string, typeof msgs>();
  for (const m of msgs) {
    const list = byConv.get(m.conversationId) ?? [];
    if (list.length < MESSAGES_PER_EXAMPLE) list.push(m);
    byConv.set(m.conversationId, list);
  }
  const nameOf = new Map(agents.map((a) => [a.id, a.name]));
  const who = (m: (typeof msgs)[number]) =>
    m.direction === "in" ? "cliente" : m.ai || m.origin === "ai" ? "agente de IA" : m.origin === "template" ? "plantilla" : "persona del equipo";

  // Primero los nombres (para reconocerlos dentro de los mensajes), luego el texto.
  const tokens = picked.map((r) => ctx.masker.name("contact", r.contacto) ?? "[sin nombre]");
  const example = (masked: boolean) =>
    picked.map((r, i) => {
      const q = (t: string, max: number) => (masked ? quarantineString(ctx.masker.text(t), max) : t.slice(0, max));
      const agentName = nameOf.get(keyOf(r.agentId)) ?? "sin agente";
      return {
        contacto: masked ? tokens[i] : r.contacto,
        agente: q(agentName, 80),
        fecha: fmt(r.fecha),
        paso_a_persona: r.handoffAt && r.handoffAt >= since ? (HANDOFF_LABEL[r.handoffReason ?? ""] ?? "otro") : null,
        mensajes: (byConv.get(r.id) ?? [])
          .slice()
          .reverse()
          .map((m) => ({ de: who(m), texto: m.text ? q(m.text, 400) : `(${m.type})` })),
      };
    });

  const base = { periodo_dias: args.dias, chats_revisados: rows.length, tope_de_chats: rows.length >= MAX_CONVERSATIONS ? MAX_CONVERSATIONS : null };
  const qm = (t: string, max: number) => quarantineString(ctx.masker.text(t), max);
  const qo = (t: string, max: number) => t.slice(0, max);
  return {
    forModel: { ...base, agentes: [...agentRows(qm), ...orphanRow], ejemplos: example(true) },
    forOwner: { ...base, agentes: [...agentRows(qo), ...orphanRow], ejemplos: example(false) },
  };
}
