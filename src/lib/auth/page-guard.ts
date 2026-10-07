import { redirect } from "next/navigation";
import { can, type Permission } from "@/lib/auth/permissions";
import { getSessionOrNull, type SessionContext } from "@/lib/auth/session";

/**
 * 020 — Guardia de PÁGINA: quien no tiene el permiso vuelve a la Bandeja en
 * vez de ver una pantalla que solo le devolvería 403. La seguridad real está
 * en las rutas de la API; esto es para que la experiencia no se rompa.
 */
export async function requirePagePermission(permission: Permission): Promise<SessionContext> {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  if (!can(session, permission)) redirect("/inbox");
  return session;
}

/** Pestañas de Ajustes y el permiso que pide cada una. */
export const SETTINGS_TAB_PERMISSION = {
  whatsapp: "settings.manage",
  messenger: "settings.manage",
  templates: "templates.manage",
  tags: "tags.manage",
  team: "users.read",
  calendar: "settings.manage",
  ads: "settings.manage",
  // 025: grupos (Propietario, o Coordinador con la delegación); la
  // supervisión dentro de la pestaña es solo del Propietario.
  "team-chat": "team_chat.create_groups",
} as const satisfies Record<string, Permission>;

/**
 * Fase D — Pestañas de Ajustes que NO piden permiso: cualquier persona con
 * sesión (Personalización → Apariencia es la vista de cada quien). Marca y
 * Navegación viven dentro de ella y piden `settings.manage` por su cuenta.
 */
export const SETTINGS_OPEN_TABS = ["personalization"] as const;
