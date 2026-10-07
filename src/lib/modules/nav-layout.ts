import type { Permission, Role } from "@/lib/auth/permissions";
import { NAV_MODULES, isModuleKey, moduleDef, type ModuleDef, type ModuleKey } from "./registry";

/**
 * 030 (PR 4) — El menú de un rol: qué entradas ve y en qué orden. Puro: lo
 * usan el layout (servidor), el menú y el editor (cliente) y la API al
 * validar.
 *
 * Ocultar es SOLO estético. Lo que decide si algo existe es el módulo de la
 * organización y lo que decide si se puede usar es el permiso; aquí solo se
 * elige, entre lo que ya se puede abrir, qué se pinta y en qué orden.
 */

export type NavLayoutItem = { key: ModuleKey; hidden: boolean };

/** Roles con menú configurable (cada uno el suyo). */
export const LAYOUT_ROLES: readonly Role[] = ["owner", "coordinador", "asesor"];

/**
 * Lo que un rol no puede ocultarse: el Propietario se quedaría sin Ajustes
 * (y con él, sin Ajustes → Navegación para deshacerlo).
 */
export const LOCKED_VISIBLE: Partial<Record<Role, readonly ModuleKey[]>> = {
  owner: ["settings"],
};

export function isLocked(role: Role, key: ModuleKey): boolean {
  return (LOCKED_VISIBLE[role] ?? []).includes(key);
}

/** ¿Puede el rol abrir esta entrada? (módulo encendido + permiso). */
export function isAvailable(
  def: ModuleDef,
  modules: ReadonlySet<ModuleKey>,
  can: (p: Permission) => boolean
): boolean {
  if (!modules.has(def.key)) return false;
  return !def.permissions || def.permissions.some((p) => can(p));
}

/** El menú de fábrica de un rol: todas las entradas, ocultas las que no son suyas. */
export function defaultLayout(role: Role): NavLayoutItem[] {
  return NAV_MODULES.map((m) => ({ key: m.key, hidden: !m.defaultRoles.includes(role) }));
}

/**
 * Lo guardado, completo y en regla: descarta claves desconocidas o
 * repetidas, agrega al final (con su visibilidad de fábrica) las entradas que
 * no estaban —un módulo nuevo—, fuerza visibles las bloqueadas y deja Ajustes
 * al final (va anclado abajo).
 */
export function normalizeLayout(saved: readonly unknown[] | null | undefined, role: Role): NavLayoutItem[] {
  const defaults = defaultLayout(role);
  const seen = new Set<ModuleKey>();
  const out: NavLayoutItem[] = [];
  for (const raw of saved ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const { key, hidden } = raw as { key?: unknown; hidden?: unknown };
    if (!isModuleKey(key) || seen.has(key) || moduleDef(key).route === null) continue;
    seen.add(key);
    out.push({ key, hidden: hidden === true });
  }
  for (const d of defaults) if (!seen.has(d.key)) out.push(d);
  const fixed = out.map((i) => (isLocked(role, i.key) ? { ...i, hidden: false } : i));
  return [...fixed.filter((i) => !moduleDef(i.key).pinnedBottom), ...fixed.filter((i) => moduleDef(i.key).pinnedBottom)];
}

/** Lo que el servidor le baja al menú (cliente): claves en orden y Ajustes. */
export type NavEntries = { keys: ModuleKey[]; settings: boolean };

export function toNavEntries(nav: ResolvedNav): NavEntries {
  return { keys: nav.main.map((m) => m.key), settings: nav.settings };
}

export type ResolvedNav = {
  /** Entradas del menú, en orden (sin Ajustes). */
  main: ModuleDef[];
  /** ¿Se pinta Ajustes abajo? */
  settings: boolean;
};

/**
 * Lo que el menú pinta. Sin `layout` (o con `custom_nav` apagado en la
 * plataforma: quien llama pasa `null`), el de fábrica.
 */
export function resolveNav(input: {
  role: Role;
  modules: ReadonlySet<ModuleKey>;
  can: (p: Permission) => boolean;
  layout: readonly unknown[] | null;
}): ResolvedNav {
  const visible = normalizeLayout(input.layout, input.role)
    .filter((i) => !i.hidden)
    .map((i) => moduleDef(i.key))
    .filter((def) => isAvailable(def, input.modules, input.can));
  // 031 (A2): con el Laboratorio a la vista —módulo encendido, permiso y no
  // oculto por el Propietario— «Agente» sale del menú: el Laboratorio ya lo
  // trae (Agentes → el general). La ruta /agent sigue viva. Sin Laboratorio
  // disponible para esta persona, «Agente» se queda donde estaba.
  const labVisible = visible.some((d) => d.key === "lab");
  return {
    main: visible.filter((d) => !d.pinnedBottom && !(labVisible && d.key === "agent")),
    settings: visible.some((d) => d.key === "settings"),
  };
}

export type LayoutProblem =
  | { code: "unknown_key"; message: string }
  | { code: "duplicate_key"; message: string }
  | { code: "locked"; message: string }
  | { code: "empty"; message: string };

/**
 * ¿Se puede guardar? Claves conocidas y sin repetir, lo bloqueado visible y,
 * con los módulos y permisos de HOY, al menos una entrada a la vista.
 */
export function validateLayout(
  items: readonly NavLayoutItem[],
  role: Role,
  modules: ReadonlySet<ModuleKey>,
  can: (p: Permission) => boolean
): LayoutProblem | null {
  const seen = new Set<string>();
  for (const i of items) {
    if (!isModuleKey(i.key) || moduleDef(i.key).route === null) {
      return { code: "unknown_key", message: `Entrada desconocida: ${String(i.key)}` };
    }
    if (seen.has(i.key)) return { code: "duplicate_key", message: `Entrada repetida: ${i.key}` };
    seen.add(i.key);
    if (i.hidden && isLocked(role, i.key)) {
      return { code: "locked", message: `El Propietario no puede ocultarse ${moduleDef(i.key).label}` };
    }
  }
  const { main, settings } = resolveNav({ role, modules, can, layout: items });
  if (main.length === 0 && !settings) {
    return { code: "empty", message: "Cada rol debe conservar al menos una entrada visible en el menú" };
  }
  return null;
}

/** ¿Es igual al de fábrica? (para no guardar una fila que no cambia nada). */
export function sameLayout(a: readonly NavLayoutItem[], b: readonly NavLayoutItem[]): boolean {
  return a.length === b.length && a.every((x, i) => x.key === b[i]?.key && x.hidden === b[i]?.hidden);
}
