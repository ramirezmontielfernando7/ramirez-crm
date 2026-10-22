import { getDb, schema } from "@/lib/db";
import { validateLimits, type DirectSettings } from "@/lib/direct-connection";
import { getDirectSettings } from "./settings";

/**
 * Conexión directa (PR 5) — La «Configuración avanzada» que se edita en
 * Ajustes: modo por defecto, regreso automático a Oficial, el ajuste opcional
 * por ventana de 24 h y los límites de envío. Solo escribe esos campos; los
 * permisos delegados y el aviso aceptado tienen sus propias pantallas.
 */

export type AdvancedInput = Pick<
  DirectSettings,
  | "defaultMode"
  | "autoReturnToMeta"
  | "preferMetaInWindow"
  | "closedWindowMode"
  | "limitsEnabled"
  | "minIntervalSeconds"
  | "perChatPerMinute"
  | "perHour"
>;

export function advancedOf(s: DirectSettings): AdvancedInput {
  return {
    defaultMode: s.defaultMode,
    autoReturnToMeta: s.autoReturnToMeta,
    preferMetaInWindow: s.preferMetaInWindow,
    closedWindowMode: s.closedWindowMode,
    limitsEnabled: s.limitsEnabled,
    minIntervalSeconds: s.minIntervalSeconds,
    perChatPerMinute: s.perChatPerMinute,
    perHour: s.perHour,
  };
}

export async function saveAdvanced(
  organizationId: string,
  input: AdvancedInput,
  updatedBy: string | null
): Promise<{ ok: true; advanced: AdvancedInput } | { ok: false; error: string }> {
  const problem = validateLimits(input);
  if (problem) return { ok: false, error: problem };
  const set = { ...input, updatedBy, updatedAt: new Date() };
  await getDb()
    .insert(schema.directConnectionSettings)
    .values({ organizationId, ...set })
    .onConflictDoUpdate({ target: schema.directConnectionSettings.organizationId, set });
  return { ok: true, advanced: advancedOf(await getDirectSettings(organizationId)) };
}
