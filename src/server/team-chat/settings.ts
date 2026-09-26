import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { DELEGABLE, hasDelegableFor, type Permission } from "@/lib/auth/permissions";
import { describeError } from "@/lib/log-safe";

/**
 * 025 — Ajustes del chat de equipo por organización. Sin fila, los defaults:
 * supervisión del Propietario ENCENDIDA, el aviso de supervisión apagado y
 * los grupos solo del Propietario.
 */
export type TeamChatSettings = {
  ownerOversight: boolean;
  showOversightNotice: boolean;
  coordinatorsCanCreateGroups: boolean;
};

export const DEFAULT_TEAM_CHAT_SETTINGS: TeamChatSettings = {
  ownerOversight: true,
  showOversightNotice: false,
  coordinatorsCanCreateGroups: false,
};

export async function getTeamChatSettings(organizationId: string): Promise<TeamChatSettings> {
  const rows = await getDb()
    .select({
      ownerOversight: schema.teamChatSettings.ownerOversight,
      showOversightNotice: schema.teamChatSettings.showOversightNotice,
      coordinatorsCanCreateGroups: schema.teamChatSettings.coordinatorsCanCreateGroups,
    })
    .from(schema.teamChatSettings)
    .where(scoped(schema.teamChatSettings.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? DEFAULT_TEAM_CHAT_SETTINGS;
}

export async function updateTeamChatSettings(
  organizationId: string,
  patch: Partial<TeamChatSettings>
): Promise<TeamChatSettings> {
  const next = { ...(await getTeamChatSettings(organizationId)), ...patch };
  await getDb()
    .insert(schema.teamChatSettings)
    .values({ organizationId, ...next, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.teamChatSettings.organizationId,
      set: { ...next, updatedAt: new Date() },
    });
  return next;
}

/**
 * ¿El aviso "El Propietario puede supervisar…" se muestra? Solo con los DOS
 * encendidos: sin supervisión no hay nada que avisar.
 */
export function oversightNoticeVisible(s: TeamChatSettings): boolean {
  return s.ownerOversight && s.showOversightNotice;
}

/** Qué ajuste enciende cada permiso delegable (ver `DELEGABLE`). */
const GRANT_SETTING: Partial<Record<Permission, keyof TeamChatSettings>> = {
  "team_chat.create_groups": "coordinatorsCanCreateGroups",
};

/** Pura: las delegaciones que estos ajustes le dan a este rol. */
export function grantsFromSettings(role: string, s: TeamChatSettings): Permission[] {
  const out: Permission[] = [];
  for (const [permission, roles] of Object.entries(DELEGABLE) as [Permission, readonly string[]][]) {
    const setting = GRANT_SETTING[permission];
    if (setting && roles.includes(role) && s[setting]) out.push(permission);
  }
  return out;
}

/**
 * Las delegaciones de la organización para la sesión de este rol. Solo
 * consulta si el rol puede recibir alguna; si la consulta falla, falla
 * CERRADO (sin delegaciones) en vez de tumbar cada petición del usuario.
 */
export async function delegatedGrants(
  organizationId: string,
  role: string
): Promise<Permission[]> {
  if (!hasDelegableFor(role)) return [];
  try {
    return grantsFromSettings(role, await getTeamChatSettings(organizationId));
  } catch (err) {
    console.error("[team-chat] no se pudieron leer las delegaciones:", describeError(err));
    return [];
  }
}
