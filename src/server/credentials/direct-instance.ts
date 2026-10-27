import { eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { DirectConnectionStatus } from "@/lib/direct-connection";
import type { EvolutionTarget } from "@/lib/evolution/client";
import { openServerKey } from "./direct";
import { open, type OpenFailure } from "./vault";

/**
 * Conexión directa (PR 3) — La conexión de UNA organización para ENVIAR:
 * estado, freno y, solo cuando se va a mandar algo, la llave de su instancia
 * en claro. La fila se lee con el pool de la app a nombre de la organización
 * (RLS); el servidor y su llave maestra, por `direct.ts` (pool de sistema).
 * La llave de instancia la guarda el PR 2 al crear la instancia; si faltara,
 * se usa la maestra del servidor. Nada de esto sale del servidor de Dashfort.
 */

export type DirectConnectionRow = typeof schema.directConnection.$inferSelect;

export type DirectConnectionInfo = {
  id: string;
  serverId: string;
  instanceName: string;
  status: DirectConnectionStatus;
  pausedUntil: Date | null;
  pauseReason: DirectConnectionRow["pauseReason"];
  disconnectCount: number;
  disconnectWindowStart: Date | null;
};

/**
 * La conexión de la organización, sin llaves. null = nunca vinculó. 046: con
 * `directNumberId`, la de ese «Mi número».
 */
export async function getDirectConnection(organizationId: string, directNumberId: string | null = null): Promise<DirectConnectionInfo | null> {
  const [row] = await getDb()
    .select()
    .from(schema.directConnection)
    .where(
      scoped(
        schema.directConnection.organizationId,
        organizationId,
        directNumberId ? eq(schema.directConnection.directNumberId, directNumberId) : isNull(schema.directConnection.directNumberId)
      )
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    serverId: row.serverId,
    instanceName: row.instanceName,
    status: row.status,
    pausedUntil: row.pausedUntil,
    pauseReason: row.pauseReason,
    disconnectCount: row.disconnectCount,
    disconnectWindowStart: row.disconnectWindowStart,
  };
}

export type DirectTargetResult =
  | { ok: true; target: EvolutionTarget }
  | { ok: false; error: "not_connected" | "not_found" | OpenFailure };

/**
 * A dónde y con qué llave mandar. Solo para el envío; nunca al log ni al
 * navegador. 046: con `directNumberId`, la instancia de ese «Mi número».
 */
export async function openDirectTarget(organizationId: string, directNumberId: string | null = null): Promise<DirectTargetResult> {
  const which = directNumberId
    ? eq(schema.directConnection.directNumberId, directNumberId)
    : isNull(schema.directConnection.directNumberId);
  const [row] = await getDb()
    .select()
    .from(schema.directConnection)
    .where(scoped(schema.directConnection.organizationId, organizationId, which))
    .limit(1);
  if (!row) return { ok: false, error: "not_connected" };
  const server = await openServerKey(row.serverId);
  if (!server.ok) return { ok: false, error: server.error };
  let apiKey = server.apiKey;
  if (row.instanceKeyCipher && row.instanceKeyIv && row.instanceKeyTag) {
    const key = open(row.instanceKeyCipher, row.instanceKeyIv, row.instanceKeyTag, row.keyVersion);
    if (!key.ok) return { ok: false, error: key.error };
    apiKey = key.value;
  }
  return { ok: true, target: { baseUrl: server.baseUrl, apiKey, instanceName: row.instanceName } };
}
