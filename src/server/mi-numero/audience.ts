import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { can, ROLES } from "@/lib/auth/permissions";

/**
 * Mi número (046), PR 7 — Quién se entera de lo que pasa en los chats de un
 * número (los avisos en vivo `number.*`):
 *
 * - Un número `personal`: solo su dueño (aislado por defecto).
 * - Un número `empresa`: su dueño y quien supervisa los números del equipo
 *   (Propietario y Coordinador, `mi_numero.manage`), que leen sus chats.
 */

/** Los roles que supervisan los números del equipo (los de `mi_numero.manage`). */
export const SUPERVISOR_ROLES: readonly string[] = ROLES.filter((role) => can({ role }, "mi_numero.manage"));

export async function supervisorIds(organizationId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(scoped(schema.member.organizationId, organizationId, inArray(schema.member.role, [...SUPERVISOR_ROLES])));
  return rows.map((r) => r.userId);
}

export async function numberAudience(
  organizationId: string,
  number: { userId: string; kind: "personal" | "empresa" }
): Promise<string[]> {
  if (number.kind !== "empresa") return [number.userId];
  return [...new Set([number.userId, ...(await supervisorIds(organizationId))])];
}
