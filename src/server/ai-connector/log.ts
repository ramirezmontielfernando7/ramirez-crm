import { and, count, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { SessionContext } from "@/lib/auth/session";
import { scoped, scopedContacts } from "@/lib/db/tenant";
import { logger } from "@/lib/log";

const log = logger("ai-connector");

/**
 * 047 — «Qué hizo tu IA». ÚNICA puerta de `ai_action_log`. Nunca el texto
 * de un mensaje ni datos del cliente: herramienta, resultado, sobre qué chat
 * o contacto y un resumen corto.
 */
export type ActionEntry = {
  organizationId: string;
  userId: string;
  connectionId: string;
  tool: string;
  outcome: "ok" | "denied" | "limited" | "error";
  conversationId?: string | null;
  contactId?: string | null;
  summary?: string | null;
};

export async function recordAction(e: ActionEntry): Promise<void> {
  try {
    await getDb()
      .insert(schema.aiActionLog)
      .values({
        id: newId("aiActionLog"),
        organizationId: e.organizationId,
        userId: e.userId,
        connectionId: e.connectionId,
        tool: /^[a-z_]{1,40}$/.test(e.tool) ? e.tool : "unknown",
        outcome: e.outcome,
        conversationId: e.conversationId ?? null,
        contactId: e.contactId ?? null,
        summary: e.summary ? e.summary.slice(0, 200) : null,
      });
  } catch (err) {
    // La bitácora no tumba la herramienta, pero se avisa en el log.
    log.error("no se pudo anotar la acción de la IA", { org: e.organizationId, tool: e.tool, err });
  }
}

/** Mensajes que mandó la IA de esta persona en las últimas 24 h (tope diario). */
export async function messagesSentLastDay(organizationId: string, userId: string, now = new Date()): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(schema.aiActionLog)
    .where(
      scoped(
        schema.aiActionLog.organizationId,
        organizationId,
        and(
          eq(schema.aiActionLog.userId, userId),
          eq(schema.aiActionLog.tool, "send_message"),
          eq(schema.aiActionLog.outcome, "ok"),
          gt(schema.aiActionLog.at, new Date(now.getTime() - 24 * 60 * 60 * 1000))
        )
      )
    );
  return Number(row?.n ?? 0);
}

export type ActionView = {
  id: string;
  at: string;
  tool: string;
  outcome: "ok" | "denied" | "limited" | "error";
  summary: string | null;
  /** Quién (solo en la vista del equipo). */
  person: string | null;
  /** Cómo firma su IA («Joe»); null = «Asistente». */
  assistantName: string | null;
  connectionName: string | null;
  /** Para abrir el chat en la Bandeja; null si quien mira no ve el contacto. */
  contactId: string | null;
  /**
   * El contacto, SOLO si quien mira lo ve en el CRM hoy (`scopedContacts`):
   * un chat privado de «Mi número» o uno que ya no le toca sale sin nombre.
   */
  contactName: string | null;
};

export const ACTIONS_PAGE = 50;

/**
 * 047 PR 5 — «Qué hizo tu IA». `mine`: lo de la persona (su IA). `team`:
 * lo de toda la empresa (quien maneja los ajustes del conector; la ruta lo
 * revisa). Nunca texto de mensajes; el nombre del contacto, solo si quien
 * mira lo puede ver.
 */
export async function listActions(
  session: SessionContext,
  opts: { scope: "mine" | "team"; before?: Date | null; limit?: number }
): Promise<{ actions: ActionView[]; nextBefore: string | null }> {
  const limit = Math.min(opts.limit ?? ACTIONS_PAGE, 100);
  const rows = await getDb()
    .select({
      id: schema.aiActionLog.id,
      at: schema.aiActionLog.at,
      tool: schema.aiActionLog.tool,
      outcome: schema.aiActionLog.outcome,
      summary: schema.aiActionLog.summary,
      contactId: schema.aiActionLog.contactId,
      person: schema.user.name,
      assistantName: schema.aiConnection.assistantName,
      connectionName: schema.aiConnection.name,
    })
    .from(schema.aiActionLog)
    .leftJoin(schema.user, eq(schema.user.id, schema.aiActionLog.userId))
    .leftJoin(
      schema.aiConnection,
      and(
        eq(schema.aiConnection.organizationId, schema.aiActionLog.organizationId),
        eq(schema.aiConnection.id, schema.aiActionLog.connectionId)
      )
    )
    .where(
      scoped(
        schema.aiActionLog.organizationId,
        session.organizationId,
        opts.scope === "mine" ? eq(schema.aiActionLog.userId, session.userId) : undefined,
        opts.before ? lt(schema.aiActionLog.at, opts.before) : undefined
      )
    )
    .orderBy(desc(schema.aiActionLog.at), desc(schema.aiActionLog.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const contactIds = [...new Set(page.map((r) => r.contactId).filter((id): id is string => !!id))];
  const visible = new Map(
    contactIds.length === 0
      ? []
      : (
          await getDb()
            .select({ id: schema.contact.id, name: schema.contact.name })
            .from(schema.contact)
            .where(scopedContacts(schema.contact.organizationId, session.access, schema.contact.id, inArray(schema.contact.id, contactIds)))
        ).map((c) => [c.id, c.name])
  );
  return {
    actions: page.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      tool: r.tool,
      outcome: r.outcome,
      summary: r.summary,
      person: opts.scope === "team" ? r.person : null,
      assistantName: r.assistantName,
      connectionName: r.connectionName,
      contactId: r.contactId && visible.has(r.contactId) ? r.contactId : null,
      contactName: r.contactId ? (visible.get(r.contactId) ?? null) : null,
    })),
    nextBefore: rows.length > limit ? page[page.length - 1]!.at.toISOString() : null,
  };
}
