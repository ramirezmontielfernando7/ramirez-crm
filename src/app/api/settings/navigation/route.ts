import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { MODULE_KEYS, NAV_MODULES } from "@/lib/modules/registry";
import { LAYOUT_ROLES, defaultLayout, isAvailable } from "@/lib/modules/nav-layout";
import type { Role } from "@/lib/auth/permissions";
import { orgHasCustomNav, orgModuleKeys } from "@/server/modules";
import {
  getNavLayouts,
  listNavLayoutEvents,
  NavLayoutError,
  resetNavLayout,
  roleCan,
  saveNavLayout,
} from "@/server/navigation/store";

export const dynamic = "force-dynamic";

/**
 * 030 (PR 4) — Ajustes → Navegación: el menú de cada rol. Solo el
 * Propietario (`settings.manage`, 403) y solo si la plataforma encendió
 * `custom_nav` para esta organización (404 si no). Ocultar es estético: las
 * rutas siguen validando permiso y módulo.
 */
async function customNavOff(organizationId: string): Promise<Response | null> {
  return (await orgHasCustomNav(organizationId)) ? null : new Response(null, { status: 404 });
}

const roleSchema = z.enum(LAYOUT_ROLES as unknown as [Role, ...Role[]]);

export const GET = withAuth(
  async (session) => {
    const off = await customNavOff(session.organizationId);
    if (off) return off;
    const org = session.organizationId;
    const modules = await orgModuleKeys(org);
    const [saved, events] = await Promise.all([getNavLayouts(org), listNavLayoutEvents(org)]);
    const roles = Object.fromEntries(
      await Promise.all(
        LAYOUT_ROLES.map(async (role) => {
          const can = await roleCan(org, role);
          return [
            role,
            {
              items: saved[role] ?? defaultLayout(role),
              customized: saved[role] !== null,
              // Lo que el rol puede abrir HOY (módulo + permiso): lo demás el
              // editor lo muestra atenuado, sin efecto aunque se marque visible.
              available: NAV_MODULES.filter((m) => isAvailable(m, modules, can)).map((m) => m.key),
            },
          ];
        })
      )
    );
    return Response.json({ roles, events });
  },
  { permission: "settings.manage" }
);

const putSchema = z.object({
  role: roleSchema,
  items: z
    .array(z.object({ key: z.enum(MODULE_KEYS), hidden: z.boolean() }).strict())
    .min(1)
    .max(MODULE_KEYS.length),
});

export const PUT = withAuth(
  async (session, req: Request) => {
    const off = await customNavOff(session.organizationId);
    if (off) return off;
    const body = await parseBody(req, putSchema);
    if (!body.ok) return body.response;
    try {
      const items = await saveNavLayout({
        organizationId: session.organizationId,
        role: body.data.role,
        items: body.data.items,
        actorUserId: session.userId,
      });
      return Response.json({ role: body.data.role, items });
    } catch (err) {
      if (err instanceof NavLayoutError) return apiError(422, err.problem.code, err.problem.message);
      throw err;
    }
  },
  { permission: "settings.manage" }
);

export const DELETE = withAuth(
  async (session, req: Request) => {
    const off = await customNavOff(session.organizationId);
    if (off) return off;
    const role = roleSchema.safeParse(new URL(req.url).searchParams.get("role"));
    if (!role.success) return apiError(400, "invalid_role", "Rol inválido");
    const items = await resetNavLayout({
      organizationId: session.organizationId,
      role: role.data,
      actorUserId: session.userId,
    });
    return Response.json({ role: role.data, items });
  },
  { permission: "settings.manage" }
);
