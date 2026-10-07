import { eq, inArray } from "drizzle-orm";
import { schema, withTenant } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { logActivity } from "@/server/activity/log";
import { agentLabel } from "./assignments";

/**
 * 031 (PR B) — Anota qué agente respondió un turno REAL y, solo si cambió
 * respecto al turno anterior, la línea «Cambió el agente que atiende»
 * (`agent_changed`). El primer turno solo fija el valor. Lectura con candado
 * de la conversación + escritura + bitácora en UNA transacción: dos turnos
 * nunca anotan el mismo cambio dos veces (además, el coalesce ya los
 * serializa por conversación).
 *
 * Devuelve `true` si anotó un cambio.
 */
export async function recordTurnAgent(input: {
  organizationId: string;
  conversationId: string;
  contactId: string;
  agentId: string;
}): Promise<boolean> {
  const { organizationId, conversationId, contactId, agentId } = input;
  return withTenant(organizationId, async (tx) => {
    const [conversation] = await tx
      .select({ lastAgentId: schema.conversation.lastAgentId })
      .from(schema.conversation)
      .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
      .limit(1)
      .for("update");
    if (!conversation || conversation.lastAgentId === agentId) return false;
    const previous = conversation.lastAgentId;

    await tx
      .update(schema.conversation)
      .set({ lastAgentId: agentId })
      .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)));
    if (!previous) return false;

    const agents = await tx
      .select()
      .from(schema.agent)
      .where(scoped(schema.agent.organizationId, organizationId, inArray(schema.agent.id, [previous, agentId])));
    const label = (id: string) => {
      const row = agents.find((a) => a.id === id);
      return row ? agentLabel(row) : null;
    };
    await logActivity(
      {
        organizationId,
        contactId,
        kind: "agent_changed",
        source: "bot",
        detail: {
          fromAgentId: previous,
          fromName: label(previous),
          toAgentId: agentId,
          toName: label(agentId),
        },
      },
      tx
    );
    return true;
  });
}
