import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { DEFAULT_STOP_KEYWORDS } from "@/lib/opt-out";

/**
 * Campañas v2 (PR 1) — Ajustes de mensajería de una organización. Sin fila,
 * los valores por defecto: palabras de baja encendidas, respuesta automática
 * APAGADA y alerta de uso del límite al 80 %.
 */
export type MessagingSettings = {
  stopKeywordsEnabled: boolean;
  stopKeywords: string[];
  stopReplyEnabled: boolean;
  stopReplyText: string | null;
  usageAlertPercent: number;
};

export const DEFAULT_MESSAGING_SETTINGS: MessagingSettings = {
  stopKeywordsEnabled: true,
  stopKeywords: [...DEFAULT_STOP_KEYWORDS],
  stopReplyEnabled: false,
  stopReplyText: null,
  usageAlertPercent: 80,
};

export async function getMessagingSettings(organizationId: string): Promise<MessagingSettings> {
  const [row] = await getDb()
    .select()
    .from(schema.messagingSettings)
    .where(scoped(schema.messagingSettings.organizationId, organizationId))
    .limit(1);
  if (!row) return { ...DEFAULT_MESSAGING_SETTINGS, stopKeywords: [...DEFAULT_MESSAGING_SETTINGS.stopKeywords] };
  return {
    stopKeywordsEnabled: row.stopKeywordsEnabled,
    stopKeywords: row.stopKeywords,
    stopReplyEnabled: row.stopReplyEnabled,
    stopReplyText: row.stopReplyText,
    usageAlertPercent: row.usageAlertPercent,
  };
}

export async function saveMessagingSettings(
  organizationId: string,
  input: MessagingSettings,
  userId: string | null
): Promise<MessagingSettings> {
  const values = {
    organizationId,
    stopKeywordsEnabled: input.stopKeywordsEnabled,
    stopKeywords: input.stopKeywords,
    stopReplyEnabled: input.stopReplyEnabled,
    stopReplyText: input.stopReplyText,
    usageAlertPercent: input.usageAlertPercent,
    updatedBy: userId,
    updatedAt: new Date(),
  };
  await getDb()
    .insert(schema.messagingSettings)
    .values(values)
    .onConflictDoUpdate({ target: schema.messagingSettings.organizationId, set: values });
  return getMessagingSettings(organizationId);
}

/**
 * 048 — «Chats nuevos de los asesores»: ¿los Asesores solo atienden los chats
 * que ya existen? Va aparte de `MessagingSettings` para que guardar las bajas
 * por palabra clave nunca lo pise. Sin fila = apagado.
 */
export async function getAdvisorNewChatsBlocked(organizationId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ blocked: schema.messagingSettings.advisorNewChatsBlocked })
    .from(schema.messagingSettings)
    .where(scoped(schema.messagingSettings.organizationId, organizationId))
    .limit(1);
  return row?.blocked ?? false;
}

export async function setAdvisorNewChatsBlocked(
  organizationId: string,
  blocked: boolean,
  userId: string | null
): Promise<void> {
  const now = new Date();
  await getDb()
    .insert(schema.messagingSettings)
    .values({
      organizationId,
      stopKeywords: [...DEFAULT_MESSAGING_SETTINGS.stopKeywords],
      advisorNewChatsBlocked: blocked,
      updatedBy: userId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.messagingSettings.organizationId,
      set: { advisorNewChatsBlocked: blocked, updatedBy: userId, updatedAt: now },
    });
}
