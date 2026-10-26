import { eq, isNull } from "drizzle-orm";
import { schema, withTenant } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { brakeAfterFailure, type FailureKind } from "@/lib/direct-send";
import { logger } from "@/lib/log";

const log = logger("direct-connection");

/**
 * Conexión directa (PR 3) — Freno de emergencia por fallos de ENVÍO. Cuenta
 * en las mismas columnas que las desconexiones del PR 2 (`disconnect_count`,
 * `disconnect_window_start`): 2 en 24 h, o un fallo que parece bloqueo, ponen
 * `paused_until` = ahora + 24 h. Con la fila bloqueada (FOR UPDATE): dos
 * fallos simultáneos cuentan dos. Nunca lanza: un freno que no se pudo
 * anotar no tumba el envío que ya falló.
 */
export async function recordDirectFailure(organizationId: string, kind: FailureKind, now = new Date()): Promise<{ paused: boolean }> {
  try {
    return await withTenant(organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.directConnection)
        .where(scoped(schema.directConnection.organizationId, organizationId, isNull(schema.directConnection.directNumberId)))
        .for("update")
        .limit(1);
      if (!row) return { paused: false };
      const next = brakeAfterFailure(row, kind, now);
      if (!next) return { paused: false };
      await tx
        .update(schema.directConnection)
        .set({ ...next, updatedAt: now })
        .where(scoped(schema.directConnection.organizationId, organizationId, eq(schema.directConnection.id, row.id)));
      const paused = next.pausedUntil !== null && next.pausedUntil > now && next.pausedUntil !== row.pausedUntil;
      if (paused) log.warn("conexión directa en pausa 24 h", { org: organizationId, reason: next.pauseReason });
      return { paused };
    });
  } catch (err) {
    log.error("no se pudo anotar el fallo de la conexión directa", { org: organizationId, err });
    return { paused: false };
  }
}
