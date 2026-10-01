import { asc, count, eq, sql } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { Db } from "@/lib/db";
import { seedOrganization } from "@/server/platform-admin/seed";

/**
 * Primer registro de la instancia: crea la organización, deja al usuario como
 * propietario y siembra pipeline + perfil del agente.
 *
 * Solo actúa si NO existe ninguna organización (las cuentas de equipo las crea
 * el propietario y reciben su membresía explícita). Un advisory lock evita que
 * dos registros simultáneos en instancia vacía creen dos organizaciones.
 */
export async function onUserCreated(userId: string, userName: string) {
  // Crear una organización es trabajo de plataforma: pool de sistema.
  const db = getSystemDb();
  await db.transaction(async (tx) => {
    // Lock transaccional de "primer arranque" (clave arbitraria fija):
    // dos registros simultáneos en instancia vacía → solo uno crea la org.
    await tx.execute(sql`select pg_advisory_xact_lock(874201)`);
    const [orgs] = await tx
      .select({ n: count() })
      .from(schema.organization);
    if ((orgs?.n ?? 0) > 0) return;

    const orgId = newId("organization");
    await tx.insert(schema.organization).values({
      id: orgId,
      name: userName ? `Negocio de ${userName}` : "Mi negocio",
      slug: "principal",
    });
    await tx.insert(schema.member).values({
      id: newId("member"),
      organizationId: orgId,
      userId,
      role: "owner",
    });
    await seedOrganization(tx as unknown as Db, orgId);
  });
}

/**
 * Organización con la que se abre una sesión nueva: la membresía más antigua
 * del usuario (hoy cada usuario tiene una sola; ver `resolveMembership`).
 */
export async function resolveActiveOrganizationId(
  userId: string
): Promise<string | null> {
  return (await resolveMembership(userId))?.organizationId ?? null;
}

/**
 * H4 — La organización (y el rol) de una sesión, de UNA sola fuente
 * determinista:
 *
 * 1. `session.activeOrganizationId` (la fija el hook de creación de sesión),
 *    SOLO si el usuario sigue siendo miembro de esa organización. Si lo
 *    sacaron, no vale: se cae al paso 2 y jamás se usa una organización de la
 *    que ya no es parte.
 * 2. Si no hay (sesión anterior a su membresía, p. ej. la cuenta de equipo
 *    recién creada), la membresía MÁS ANTIGUA, con `id` como desempate. Nunca
 *    "la primera que devuelva Postgres".
 *
 * Hoy un usuario pertenece a una sola organización (decisión de la Fase 1);
 * esto la hace determinista aunque por error tuviera dos.
 */
export async function resolveMembership(
  userId: string,
  activeOrganizationId?: string | null
): Promise<{ organizationId: string; role: string } | null> {
  // Es justo lo que decide la organización de la sesión: todavía no hay una
  // con la cual fijar `app.org_id`. Pool de sistema.
  const db = getSystemDb();
  const cols = {
    organizationId: schema.member.organizationId,
    role: schema.member.role,
  };
  if (activeOrganizationId) {
    const active = await db
      .select(cols)
      .from(schema.member)
      .where(
        scoped(
          schema.member.organizationId,
          activeOrganizationId,
          eq(schema.member.userId, userId)
        )
      )
      .limit(1);
    if (active[0]) return active[0];
  }
  const rows = await db
    .select(cols)
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    .orderBy(asc(schema.member.createdAt), asc(schema.member.id))
    .limit(1);
  return rows[0] ?? null;
}
