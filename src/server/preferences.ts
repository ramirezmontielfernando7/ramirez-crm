import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/** 022 — Preferencias de interfaz de una persona en este negocio. */
export type UserPreferences = { navCollapsed: boolean | null };

export async function getUserPreferences(
  organizationId: string,
  userId: string
): Promise<UserPreferences> {
  const rows = await getDb()
    .select({ navCollapsed: schema.userPreference.navCollapsed })
    .from(schema.userPreference)
    .where(
      scoped(
        schema.userPreference.organizationId,
        organizationId,
        eq(schema.userPreference.userId, userId)
      )
    )
    .limit(1);
  return { navCollapsed: rows[0]?.navCollapsed ?? null };
}

export async function saveUserPreferences(
  organizationId: string,
  userId: string,
  patch: UserPreferences
): Promise<void> {
  const now = new Date();
  await getDb()
    .insert(schema.userPreference)
    .values({ organizationId, userId, navCollapsed: patch.navCollapsed, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.userPreference.organizationId, schema.userPreference.userId],
      set: { navCollapsed: patch.navCollapsed, updatedAt: now },
    });
}
