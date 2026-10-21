import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  cleanRoles,
  DEFAULT_DIRECT_SETTINGS,
  isConnectionMode,
  type DirectSettings,
} from "@/lib/direct-connection";

/**
 * Conexión directa (PR 1) — La «Configuración avanzada» de una organización
 * (`direct_connection_settings`). Sin fila, `DEFAULT_DIRECT_SETTINGS`. Se lee
 * con el pool de la app a nombre de la organización (RLS). La escritura
 * llega con la pantalla (PR 3); aquí solo se lee.
 */

type Row = typeof schema.directConnectionSettings.$inferSelect;

/** Pura: la fila tal como la usa el resto del código (roles limpios, falla cerrado). */
export function settingsFromRow(row: Row | undefined): DirectSettings {
  if (!row) return DEFAULT_DIRECT_SETTINGS;
  return {
    defaultMode: isConnectionMode(row.defaultMode) ? row.defaultMode : "meta",
    limitsEnabled: row.limitsEnabled,
    minIntervalSeconds: row.minIntervalSeconds,
    perChatPerMinute: row.perChatPerMinute,
    perHour: row.perHour,
    preferMetaInWindow: row.preferMetaInWindow,
    autoReturnToMeta: row.autoReturnToMeta,
    closedWindowMode: row.closedWindowMode === "directa" ? "directa" : "mixta",
    aiViaDirect: row.aiViaDirect,
    modeRoles: cleanRoles(row.modeRoles),
    linkRoles: cleanRoles(row.linkRoles),
    limitsRoles: cleanRoles(row.limitsRoles),
    noticeAcceptedBy: row.noticeAcceptedBy,
    noticeAcceptedAt: row.noticeAcceptedAt,
  };
}

export async function getDirectSettings(organizationId: string): Promise<DirectSettings> {
  const [row] = await getDb()
    .select()
    .from(schema.directConnectionSettings)
    .where(scoped(schema.directConnectionSettings.organizationId, organizationId))
    .limit(1);
  return settingsFromRow(row);
}
