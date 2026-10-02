import { can, isRole } from "@/lib/auth/permissions";
import type { SessionContext } from "@/lib/auth/session";
import { runWithOrganization } from "@/lib/request-context";
import { resolveNav, type ResolvedNav } from "@/lib/modules/nav-layout";
import type { ModuleKey } from "@/lib/modules/registry";
import { getOrgModules, enabledModuleKeys } from "@/server/modules";
import { getNavLayout } from "./store";

export type SessionNav = ResolvedNav & {
  /** Módulos encendidos de la organización (para lo que no es el menú). */
  modules: ModuleKey[];
  /** ¿La plataforma dejó personalizar el menú? (pestaña Ajustes → Navegación). */
  customNav: boolean;
};

/**
 * 030 (PR 4) — El menú de quien pide: módulos de su organización, permisos de
 * su rol (con delegaciones) y, si la plataforma encendió `custom_nav`, el
 * menú que el Propietario guardó para su rol. Lo usa el layout en el
 * servidor: el menú llega pintado, sin parpadeo.
 */
export async function navForSession(session: SessionContext): Promise<SessionNav> {
  const m = await getOrgModules(session.organizationId);
  const modules = enabledModuleKeys(m);
  const layout =
    m.customNav && isRole(session.role)
      ? await runWithOrganization(session.organizationId, () => getNavLayout(session.organizationId, session.role))
      : null;
  const role = isRole(session.role) ? session.role : "asesor";
  const nav = isRole(session.role)
    ? resolveNav({ role, modules, can: (p) => can(session, p), layout })
    : { main: [], settings: false };
  return { ...nav, modules: [...modules], customNav: m.customNav };
}
