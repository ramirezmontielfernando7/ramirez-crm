import { and, count, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
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
type ActionEntry = {
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

/** Mensajes (texto y plantillas) que mandó la IA de esta persona en las últimas 24 h (tope diario). */
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
          inArray(schema.aiActionLog.tool, [...SENDING_TOOLS]),
          eq(schema.aiActionLog.outcome, "ok"),
          gt(schema.aiActionLog.at, new Date(now.getTime() - 24 * 60 * 60 * 1000))
        )
      )
    );
  return Number(row?.n ?? 0);
}

/** Herramientas que mandan mensajes: comparten el MISMO tope diario. */
export const SENDING_TOOLS = ["send_message", "send_template", "send_material"] as const;

/**
 * Auditoría DF-07 — Reserva ATÓMICA de un envío contra el tope diario.
 *
 * Antes se contaba lo anotado en la bitácora y se enviaba: dos herramientas
 * distintas a la vez (o dos procesos) leían el mismo conteo y se pasaban del
 * tope, y si la bitácora fallaba tras enviar, el envío no contaba. Ahora,
 * con un candado de PostgreSQL por persona (vale entre procesos), se cuenta
 * y se anota la reserva (`ok`) en una sola transacción, ANTES de enviar. Si
 * no se puede anotar, no se envía. Al terminar, `settleDailySend` deja el
 * resultado: un envío que falló (`error`) libera su lugar.
 */
export async function reserveDailySend(e: {
  organizationId: string;
  userId: string;
  connectionId: string;
  tool: (typeof SENDING_TOOLS)[number];
  limit: number;
  conversationId?: string | null;
  contactId?: string | null;
  now?: Date;
}): Promise<{ ok: true; reservationId: string; sent: number } | { ok: false; sent: number }> {
  const now = e.now ?? new Date();
  return getDb().transaction(async (tx) => {
    // Candado de transacción por organización y persona: se suelta solo al terminar.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ai-send:${e.organizationId}:${e.userId}`}))`);
    const [row] = await tx
      .select({ n: count() })
      .from(schema.aiActionLog)
      .where(
        scoped(
          schema.aiActionLog.organizationId,
          e.organizationId,
          and(
            eq(schema.aiActionLog.userId, e.userId),
            inArray(schema.aiActionLog.tool, [...SENDING_TOOLS]),
            eq(schema.aiActionLog.outcome, "ok"),
            gt(schema.aiActionLog.at, new Date(now.getTime() - 24 * 60 * 60 * 1000))
          )
        )
      );
    const sent = Number(row?.n ?? 0);
    if (sent >= e.limit) return { ok: false as const, sent };
    const reservationId = newId("aiActionLog");
    await tx.insert(schema.aiActionLog).values({
      id: reservationId,
      organizationId: e.organizationId,
      userId: e.userId,
      connectionId: e.connectionId,
      tool: e.tool,
      outcome: "ok",
      conversationId: e.conversationId ?? null,
      contactId: e.contactId ?? null,
      summary: "enviando…",
      at: now,
    });
    return { ok: true as const, reservationId, sent };
  });
}

/** Deja el resultado de un envío reservado. Nunca lanza (si falla, la reserva sigue contando). */
export async function settleDailySend(
  organizationId: string,
  reservationId: string,
  result: { outcome: "ok" | "denied" | "limited" | "error"; summary: string }
): Promise<void> {
  try {
    await getDb()
      .update(schema.aiActionLog)
      .set({ outcome: result.outcome, summary: result.summary.slice(0, 200) })
      .where(scoped(schema.aiActionLog.organizationId, organizationId, eq(schema.aiActionLog.id, reservationId)));
  } catch (err) {
    log.error("no se pudo cerrar la reserva de un envío de la IA (sigue contando en el tope)", { org: organizationId, err });
  }
}

type ActionView = {
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

const ACTIONS_PAGE = 50;

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
