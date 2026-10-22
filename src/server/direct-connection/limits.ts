import { schema, getDb } from "@/lib/db";
import { validateLimits, type DirectSettings } from "@/lib/direct-connection";
import { getDirectSettings } from "./settings";

/**
 * Conexión directa (PR 3) — Escribe los límites de envío de la
 * «Configuración avanzada» (`direct_connection_settings`). Solo los cuatro
 * datos de los límites: el resto de la fila (modo por defecto, permisos,
 * aviso) lo escriben sus propias pantallas. Sin fila, nace con los DEFAULT
 * de la 0055 y estos cuatro valores.
 */

export type LimitsInput = Pick<DirectSettings, "limitsEnabled" | "minIntervalSeconds" | "perChatPerMinute" | "perHour">;

export function limitsOf(s: DirectSettings): LimitsInput {
  return {
    limitsEnabled: s.limitsEnabled,
    minIntervalSeconds: s.minIntervalSeconds,
    perChatPerMinute: s.perChatPerMinute,
    perHour: s.perHour,
  };
}

export async function saveDirectLimits(
  organizationId: string,
  input: LimitsInput,
  updatedBy: string | null
): Promise<{ ok: true; limits: LimitsInput } | { ok: false; error: string }> {
  const problem = validateLimits(input);
  if (problem) return { ok: false, error: problem };
  const set = { ...input, updatedBy, updatedAt: new Date() };
  await getDb()
    .insert(schema.directConnectionSettings)
    .values({ organizationId, ...set })
    .onConflictDoUpdate({ target: schema.directConnectionSettings.organizationId, set });
  return { ok: true, limits: limitsOf(await getDirectSettings(organizationId)) };
}
