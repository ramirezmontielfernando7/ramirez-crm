import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isNavMode, type NavMode } from "@/lib/preferences";

/**
 * 022 — Preferencias de interfaz de una persona en este negocio.
 * `navMode` es el estado de tres pasos del menú; `navCollapsed` es la
 * preferencia original de dos, que se sigue escribiendo (colapsado u oculto =
 * `true`) para que nada que la lea se rompa.
 */
export type UserPreferences = { navMode: NavMode | null; navCollapsed: boolean | null };

export async function getUserPreferences(
  organizationId: string,
  userId: string
): Promise<UserPreferences> {
  const rows = await getDb()
    .select({
      navMode: schema.userPreference.navMode,
      navCollapsed: schema.userPreference.navCollapsed,
    })
    .from(schema.userPreference)
    .where(
      scoped(
        schema.userPreference.organizationId,
        organizationId,
        eq(schema.userPreference.userId, userId)
      )
    )
    .limit(1);
  const row = rows[0];
  return {
    navMode: isNavMode(row?.navMode) ? row.navMode : null,
    navCollapsed: row?.navCollapsed ?? null,
  };
}

/**
 * Guarda el menú. Llega el modo de tres estados o, de un cliente viejo, solo
 * `navCollapsed`; los dos campos quedan siempre coherentes entre sí.
 * `null` = volver al default del rol.
 */
export async function saveUserPreferences(
  organizationId: string,
  userId: string,
  patch: { navMode?: NavMode | null; navCollapsed?: boolean | null }
): Promise<UserPreferences> {
  let prefs: UserPreferences;
  if (patch.navMode !== undefined) {
    prefs = {
      navMode: patch.navMode,
      navCollapsed: patch.navMode === null ? null : patch.navMode !== "expanded",
    };
  } else {
    const collapsed = patch.navCollapsed ?? null;
    prefs = {
      navMode: collapsed === null ? null : collapsed ? "collapsed" : "expanded",
      navCollapsed: collapsed,
    };
  }
  const now = new Date();
  await getDb()
    .insert(schema.userPreference)
    .values({ organizationId, userId, ...prefs, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.userPreference.organizationId, schema.userPreference.userId],
      set: { ...prefs, updatedAt: now },
    });
  return prefs;
}
