import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { mirrorFields, type AgentConfig } from "./config";

/**
 * 031 — Espejo del agente GENERAL publicado en `agent_profile`.
 *
 * `agent_profile` sigue siendo lo que leen `/api/bot/profile`, los seeds, las
 * fixtures y —tras un rollback— la imagen anterior. Se escribe SIEMPRE en la
 * misma transacción que publica al general, con la MISMA hora que
 * `agent.published_at`: así la reconciliación (`ensure.ts`) sabe que están
 * al día. Nunca toca `enabled` (el interruptor global es del Propietario).
 *
 * Además del PUT histórico de `/api/agent/profile` (vía `store.ts`), es el
 * único lugar que escribe el comportamiento en `agent_profile`.
 */
export async function syncGeneralToProfile(
  tx: Db,
  organizationId: string,
  config: AgentConfig,
  at: Date
): Promise<void> {
  await tx
    .update(schema.agentProfile)
    .set({ ...mirrorFields(config), updatedAt: at })
    .where(scoped(schema.agentProfile.organizationId, organizationId));
}
