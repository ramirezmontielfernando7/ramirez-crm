import { desc, eq } from "drizzle-orm";
import { getDb, schema, withTenant } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { can, type Permission, type Role } from "@/lib/auth/permissions";
import type { ModuleKey } from "@/lib/modules/registry";
import {
  LAYOUT_ROLES,
  defaultLayout,
  normalizeLayout,
  sameLayout,
  validateLayout,
  type LayoutProblem,
  type NavLayoutItem,
} from "@/lib/modules/nav-layout";
import { orgModuleKeys } from "@/server/modules";
import { delegatedGrants } from "@/server/team-chat/settings";

/**
 * 030 (PR 4) — ÚNICA puerta de `nav_layout` y `nav_layout_event`.
 *
 * El menú de cada rol en una organización. Sin fila, el de fábrica. Cada
 * cambio (guardar o restaurar) va a la bitácora en la MISMA transacción, con
 * el antes y el después. Todo dentro de `withTenant`: RLS por organización.
 */

export type RoleLayouts = Record<Role, NavLayoutItem[] | null>;

/** Lo guardado de cada rol (`null` = de fábrica). Ya normalizado. */
export async function getNavLayouts(organizationId: string): Promise<RoleLayouts> {
  const rows = await getDb()
    .select({ role: schema.navLayout.role, items: schema.navLayout.items })
    .from(schema.navLayout)
    .where(scoped(schema.navLayout.organizationId, organizationId));
  const out: RoleLayouts = { owner: null, coordinador: null, asesor: null };
  for (const r of rows) {
    const role = r.role as Role;
    if (LAYOUT_ROLES.includes(role)) out[role] = normalizeLayout(r.items as unknown[], role);
  }
  return out;
}

/** El de un rol, crudo para `resolveNav` (`null` = de fábrica). */
export async function getNavLayout(organizationId: string, role: string): Promise<unknown[] | null> {
  const [row] = await getDb()
    .select({ items: schema.navLayout.items })
    .from(schema.navLayout)
    .where(scoped(schema.navLayout.organizationId, organizationId, eq(schema.navLayout.role, role)))
    .limit(1);
  return Array.isArray(row?.items) ? (row.items as unknown[]) : null;
}

/** Lo que un rol puede hacer en ESTA organización (con sus delegaciones). */
export async function roleCan(organizationId: string, role: Role): Promise<(p: Permission) => boolean> {
  const grants = await delegatedGrants(organizationId, role);
  return (p) => can({ role, grants }, p);
}

export class NavLayoutError extends Error {
  constructor(readonly problem: LayoutProblem) {
    super(problem.message);
    this.name = "NavLayoutError";
  }
}

/**
 * Guarda el menú de un rol. Valida con los módulos y permisos de HOY (al
 * menos una entrada visible; el Propietario no se oculta Ajustes). Si queda
 * igual al de fábrica, se borra la fila: así un módulo nuevo aparece solo.
 */
export async function saveNavLayout(input: {
  organizationId: string;
  role: Role;
  items: NavLayoutItem[];
  actorUserId: string;
}): Promise<NavLayoutItem[]> {
  const { organizationId, role } = input;
  const modules: ReadonlySet<ModuleKey> = await orgModuleKeys(organizationId);
  const problem = validateLayout(input.items, role, modules, await roleCan(organizationId, role));
  if (problem) throw new NavLayoutError(problem);
  const items = normalizeLayout(input.items, role);
  const isDefault = sameLayout(items, defaultLayout(role));
  await withTenant(organizationId, async (tx) => {
    const [prev] = await tx
      .select({ items: schema.navLayout.items })
      .from(schema.navLayout)
      .where(scoped(schema.navLayout.organizationId, organizationId, eq(schema.navLayout.role, role)))
      .limit(1)
      .for("update");
    const before = prev ? normalizeLayout(prev.items as unknown[], role) : null;
    if ((before && sameLayout(before, items)) || (!before && isDefault)) return;
    if (isDefault) {
      await tx
        .delete(schema.navLayout)
        .where(scoped(schema.navLayout.organizationId, organizationId, eq(schema.navLayout.role, role)));
    } else {
      const now = new Date();
      await tx
        .insert(schema.navLayout)
        .values({ organizationId, role, items, updatedAt: now, updatedBy: input.actorUserId })
        .onConflictDoUpdate({
          target: [schema.navLayout.organizationId, schema.navLayout.role],
          set: { items, updatedAt: now, updatedBy: input.actorUserId },
        });
    }
    await tx.insert(schema.navLayoutEvent).values({
      id: newId("navLayoutEvent"),
      organizationId,
      role,
      action: isDefault ? "reset" : "saved",
      actorUserId: input.actorUserId,
      before,
      after: isDefault ? null : items,
    });
  });
  return items;
}

/** «Restaurar valores por defecto» de un rol. */
export async function resetNavLayout(input: {
  organizationId: string;
  role: Role;
  actorUserId: string;
}): Promise<NavLayoutItem[]> {
  const { organizationId, role } = input;
  await withTenant(organizationId, async (tx) => {
    const [prev] = await tx
      .delete(schema.navLayout)
      .where(scoped(schema.navLayout.organizationId, organizationId, eq(schema.navLayout.role, role)))
      .returning({ items: schema.navLayout.items });
    if (!prev) return;
    await tx.insert(schema.navLayoutEvent).values({
      id: newId("navLayoutEvent"),
      organizationId,
      role,
      action: "reset",
      actorUserId: input.actorUserId,
      before: normalizeLayout(prev.items as unknown[], role),
      after: null,
    });
  });
  return defaultLayout(role);
}

export type NavLayoutEventDto = {
  id: string;
  role: Role;
  action: "saved" | "reset";
  actorName: string | null;
  at: string;
};

/** Lo más reciente primero (para Ajustes → Navegación). */
export async function listNavLayoutEvents(organizationId: string, limit = 20): Promise<NavLayoutEventDto[]> {
  const rows = await getDb()
    .select({
      id: schema.navLayoutEvent.id,
      role: schema.navLayoutEvent.role,
      action: schema.navLayoutEvent.action,
      actorName: schema.user.name,
      at: schema.navLayoutEvent.at,
    })
    .from(schema.navLayoutEvent)
    .leftJoin(schema.user, eq(schema.user.id, schema.navLayoutEvent.actorUserId))
    .where(scoped(schema.navLayoutEvent.organizationId, organizationId))
    .orderBy(desc(schema.navLayoutEvent.at))
    .limit(Math.min(limit, 100));
  return rows.map((r) => ({
    id: r.id,
    role: r.role as Role,
    action: r.action,
    actorName: r.actorName ?? null,
    at: r.at.toISOString(),
  }));
}
