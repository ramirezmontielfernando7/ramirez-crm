import { and, desc, eq, notInArray } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { AgentConfig } from "./config";

/** 031 — Cuántas versiones se guardan por agente. */
export const VERSIONS_KEPT = 30;

export type PublishAction = "publish" | "restore" | "legacy_put" | "make_general";

/**
 * Anota una versión en `agent_publish_log` y recorta a las últimas
 * `VERSIONS_KEPT` de ese agente. Va dentro de la transacción de quien llama.
 */
export async function appendPublishLog(
  tx: Db,
  input: {
    organizationId: string;
    agentId: string;
    action: PublishAction;
    snapshot: AgentConfig;
    actorUserId: string | null;
    at?: Date;
  }
): Promise<void> {
  const log = schema.agentPublishLog;
  await tx.insert(log).values({
    id: newId("agentPublishLog"),
    organizationId: input.organizationId,
    agentId: input.agentId,
    action: input.action,
    snapshot: input.snapshot,
    actorUserId: input.actorUserId,
    ...(input.at ? { at: input.at } : {}),
  });
  const keep = tx
    .select({ id: log.id })
    .from(log)
    .where(scoped(log.organizationId, input.organizationId, eq(log.agentId, input.agentId)))
    .orderBy(desc(log.at), desc(log.id))
    .limit(VERSIONS_KEPT);
  await tx
    .delete(log)
    .where(scoped(log.organizationId, input.organizationId, and(eq(log.agentId, input.agentId), notInArray(log.id, keep))));
}
