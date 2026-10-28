import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  ADVANCED_AREAS,
  DEFAULT_CONNECTOR_SETTINGS,
  type AdvancedArea,
  type AdvancedSettings,
  type ConnectorSettings,
} from "@/lib/ai-connector";

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
      advancedEnabled: schema.aiConnectorSettings.advancedEnabled,
      advancedRoles: schema.aiConnectorSettings.advancedRoles,
      advancedAreas: schema.aiConnectorSettings.advancedAreas,
      advancedLaunchCampaigns: schema.aiConnectorSettings.advancedLaunchCampaigns,
    })
    .from(schema.aiConnectorSettings)
    .where(scoped(schema.aiConnectorSettings.organizationId, organizationId))
    .limit(1);
  if (!row) return DEFAULT_CONNECTOR_SETTINGS;
  return {
    enabled: row.enabled,
    allowedRoles: row.allowedRoles,
    dailyMessageLimit: row.dailyMessageLimit,
    advanced: {
      enabled: row.advancedEnabled,
      roles: row.advancedRoles,
      areas: row.advancedAreas.filter(isArea),
      launchCampaigns: row.advancedLaunchCampaigns,
    },
  };
}

function isArea(a: string): a is AdvancedArea {
  return (ADVANCED_AREAS as readonly string[]).includes(a);
}

function advancedValues(a: AdvancedSettings) {
  return {
    advancedEnabled: a.enabled,
    advancedRoles: a.roles.includes("coordinador") ? ["coordinador"] : [],
    advancedAreas: ADVANCED_AREAS.filter((x) => a.areas.includes(x)),
    advancedLaunchCampaigns: a.launchCampaigns,
  };
}

/**
 * Guarda los ajustes del Propietario (PR 3 los expone en Ajustes). Sin
 * `advanced`, las funciones avanzadas quedan como estaban.
 */
export async function saveConnectorSettings(
  organizationId: string,
  actorId: string,
  next: Omit<ConnectorSettings, "advanced"> & { advanced?: AdvancedSettings }
): Promise<void> {
  const values = {
    enabled: next.enabled,
    allowedRoles: [...new Set(next.allowedRoles.filter((r) => r === "coordinador" || r === "asesor"))],
    dailyMessageLimit: Math.max(0, Math.min(1000, Math.trunc(next.dailyMessageLimit))),
    ...(next.advanced ? advancedValues(next.advanced) : {}),
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
