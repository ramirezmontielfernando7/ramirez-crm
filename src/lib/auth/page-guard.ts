import { redirect } from "next/navigation";
import { can, type Permission } from "@/lib/auth/permissions";
import { getSessionOrNull } from "@/lib/auth/session";

/**
 * 020 — Guardia de PÁGINA: quien no tiene el permiso vuelve a la Bandeja en
 * vez de ver una pantalla que solo le devolvería 403. La seguridad real está
 * en las rutas de la API; esto es para que la experiencia no se rompa.
 */
export async function requirePagePermission(permission: Permission): Promise<void> {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  if (!can(session, permission)) redirect("/inbox");
}

/** Pestañas de Ajustes y el permiso que pide cada una. */
export const SETTINGS_TAB_PERMISSION = {
  whatsapp: "settings.manage",
  messenger: "settings.manage",
  branding: "settings.manage",
  templates: "templates.manage",
  team: "users.read",
  calendar: "settings.manage",
  ads: "settings.manage",
} as const satisfies Record<string, Permission>;
