import { DELEGABLE, type Permission } from "@/lib/auth/permissions";
import type { DirectSettings } from "@/lib/direct-connection";
import { logger } from "@/lib/log";
import { orgHasConexionDirecta } from "@/server/modules";
import { getDirectSettings } from "./settings";

const log = logger("direct-connection");

/** Cada permiso de la conexión directa y la lista de roles que lo recibe. */
const ROLES_OF: Record<"direct_connection.mode" | "direct_connection.link" | "direct_connection.limits", keyof DirectSettings> = {
  "direct_connection.mode": "modeRoles",
  "direct_connection.link": "linkRoles",
  "direct_connection.limits": "limitsRoles",
};
const PERMISSIONS = Object.keys(ROLES_OF) as (keyof typeof ROLES_OF)[];

function canReceive(role: string): boolean {
  return PERMISSIONS.some((p) => (DELEGABLE[p] ?? []).includes(role as never));
}

/** Pura: lo que estos ajustes le delegan a este rol (solo lo que `DELEGABLE` admite). */
export function grantsFromDirectSettings(role: string, s: DirectSettings): Permission[] {
  return PERMISSIONS.filter((p) => {
    const roles = s[ROLES_OF[p]] as readonly string[];
    return roles.includes(role) && (DELEGABLE[p] ?? []).includes(role as never);
  });
}

/**
 * Conexión directa (PR 1) — Las delegaciones de la organización para este
 * rol. Sin el módulo, ninguna (y no se leen sus ajustes). Si algo falla,
 * falla CERRADO: sin delegaciones, en vez de tumbar la petición.
 */
export async function directConnectionGrants(organizationId: string, role: string): Promise<Permission[]> {
  if (!canReceive(role)) return [];
  try {
    if (!(await orgHasConexionDirecta(organizationId))) return [];
    return grantsFromDirectSettings(role, await getDirectSettings(organizationId));
  } catch (err) {
    log.error("no se pudieron leer las delegaciones de la conexión directa", { org: organizationId, err });
    return [];
  }
}
