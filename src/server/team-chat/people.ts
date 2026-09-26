import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { roleLabel } from "@/lib/auth/permissions";
import type { TeamPersonDto } from "@/lib/team-chat";

/**
 * 025 — Las personas del equipo (miembros ACTUALES de la organización). Solo
 * nombre y rol: nada de datos de clientes, así que cualquier rol las ve.
 * Quien sale de la organización deja de aparecer aquí y, con eso, de las
 * audiencias del chat (ver `audience.ts`).
 */
export async function listPeople(organizationId: string): Promise<TeamPersonDto[]> {
  const rows = await getDb()
    .select({ id: schema.user.id, name: schema.user.name, role: schema.member.role })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(scoped(schema.member.organizationId, organizationId));
  return rows
    .map((r) => ({ id: r.id, name: r.name, role: roleLabel(r.role) }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** De estos ids, cuáles son miembros actuales de la organización. */
export async function currentMemberIds(
  organizationId: string,
  userIds: readonly string[]
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await getDb()
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(
      scoped(schema.member.organizationId, organizationId, inArray(schema.member.userId, [...userIds]))
    );
  return new Set(rows.map((r) => r.userId));
}

/** Todos los miembros actuales con su rol (para calcular audiencias). */
export async function orgMembers(
  organizationId: string
): Promise<{ userId: string; role: string }[]> {
  return getDb()
    .select({ userId: schema.member.userId, role: schema.member.role })
    .from(schema.member)
    .where(and(scoped(schema.member.organizationId, organizationId)));
}
