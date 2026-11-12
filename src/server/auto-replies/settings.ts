import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  DEFAULT_AUTO_HOURS,
  DEFAULT_AUTO_TIMEZONE,
  parseAutoHours,
  type AutoHours,
} from "@/lib/auto-replies";
import { DEFAULT_STOP_KEYWORDS } from "@/lib/opt-out";
import { isValidTimeZone } from "@/lib/time/slots";

/**
 * 049 — Ajustes de los mensajes automáticos sin IA y del aviso de chats
 * olvidados. Viven en `messaging_settings` pero se leen y escriben APARTE de
 * `MessagingSettings` (como «Chats nuevos de los asesores»): guardar las
 * bajas por palabra clave nunca los pisa, ni al revés. Sin fila = todo apagado.
 */
export type AutoReplySettings = {
  welcomeEnabled: boolean;
  welcomeText: string | null;
  awayEnabled: boolean;
  awayText: string | null;
  hours: AutoHours;
  timezone: string;
  /** Horas sin respuesta para avisar de un chat olvidado; null = sin aviso. */
  forgottenAlertHours: number | null;
};

export const DEFAULT_AUTO_REPLY_SETTINGS: AutoReplySettings = {
  welcomeEnabled: false,
  welcomeText: null,
  awayEnabled: false,
  awayText: null,
  hours: DEFAULT_AUTO_HOURS,
  timezone: DEFAULT_AUTO_TIMEZONE,
  forgottenAlertHours: null,
};

type Row = typeof schema.messagingSettings.$inferSelect;

export function autoSettingsFromRow(row: Row | undefined): AutoReplySettings {
  if (!row) return { ...DEFAULT_AUTO_REPLY_SETTINGS };
  return {
    welcomeEnabled: row.welcomeEnabled,
    welcomeText: row.welcomeText,
    awayEnabled: row.awayEnabled,
    awayText: row.awayText,
    hours: parseAutoHours(row.autoHours),
    timezone: isValidTimeZone(row.autoTimezone) ? row.autoTimezone : DEFAULT_AUTO_TIMEZONE,
    forgottenAlertHours: row.forgottenAlertHours,
  };
}

export async function getAutoReplySettings(organizationId: string): Promise<AutoReplySettings> {
  const [row] = await getDb()
    .select()
    .from(schema.messagingSettings)
    .where(scoped(schema.messagingSettings.organizationId, organizationId))
    .limit(1);
  return autoSettingsFromRow(row);
}

export async function saveAutoReplySettings(
  organizationId: string,
  input: AutoReplySettings,
  userId: string | null
): Promise<AutoReplySettings> {
  const auto = {
    welcomeEnabled: input.welcomeEnabled,
    welcomeText: input.welcomeText,
    awayEnabled: input.awayEnabled,
    awayText: input.awayText,
    autoHours: input.hours,
    autoTimezone: input.timezone,
    forgottenAlertHours: input.forgottenAlertHours,
    updatedBy: userId,
    updatedAt: new Date(),
  };
  // Una organización sin fila aún: se crea con las palabras de baja de siempre.
  await getDb()
    .insert(schema.messagingSettings)
    .values({ organizationId, stopKeywords: [...DEFAULT_STOP_KEYWORDS], ...auto })
    .onConflictDoUpdate({ target: schema.messagingSettings.organizationId, set: auto });
  return getAutoReplySettings(organizationId);
}
