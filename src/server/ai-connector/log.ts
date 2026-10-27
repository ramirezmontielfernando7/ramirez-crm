import { and, count, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
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
