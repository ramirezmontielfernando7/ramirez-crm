import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { DEFAULT_CONNECTOR_SETTINGS, type ConnectorSettings } from "@/lib/ai-connector";

/**
 * 047 — Lo que decidió el Propietario sobre el conector de IA de su
 * organización. Sin fila = apagado. Se lee a nombre de la organización.
 */
export async function getConnectorSettings(organizationId: string): Promise<ConnectorSettings> {
  const [row] = await getDb()
    .select({
      enabled: schema.aiConnectorSettings.enabled,
      allowedRoles: schema.aiConnectorSettings.allowedRoles,
      dailyMessageLimit: schema.aiConnectorSettings.dailyMessageLimit,
    })
    .from(schema.aiConnectorSettings)
    .where(scoped(schema.aiConnectorSettings.organizationId, organizationId))
    .limit(1);
  return row ?? DEFAULT_CONNECTOR_SETTINGS;
}

/** Guarda los ajustes del Propietario (PR 3 los expone en Ajustes). */
export async function saveConnectorSettings(
  organizationId: string,
  actorId: string,
  next: ConnectorSettings
): Promise<void> {
  const values = {
    enabled: next.enabled,
    allowedRoles: [...new Set(next.allowedRoles.filter((r) => r === "coordinador" || r === "asesor"))],
    dailyMessageLimit: Math.max(0, Math.min(1000, Math.trunc(next.dailyMessageLimit))),
    updatedAt: new Date(),
    updatedBy: actorId,
  };
  await getDb()
    .insert(schema.aiConnectorSettings)
    .values({ organizationId, ...values })
    .onConflictDoUpdate({
      target: schema.aiConnectorSettings.organizationId,
      set: values,
      where: eq(schema.aiConnectorSettings.organizationId, organizationId),
    });
}
