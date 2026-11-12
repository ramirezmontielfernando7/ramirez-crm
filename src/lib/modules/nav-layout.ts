import type { Permission, Role } from "@/lib/auth/permissions";
import { NAV_MODULES, isModuleKey, moduleDef, type ModuleDef, type ModuleKey, type NavGroup, type NavSection } from "./registry";

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
const LOCKED_VISIBLE: Partial<Record<Role, readonly ModuleKey[]>> = {
  owner: ["settings"],
};

export function isLocked(role: Role, key: ModuleKey): boolean {
  return (LOCKED_VISIBLE[role] ?? []).includes(key);
}

/** Lo mínimo para decidir qué existe: ¿está el módulo? ¿tiene el permiso? */
type Has = { has: (key: ModuleKey) => boolean };

/** 039 — ¿Se puede abrir esta pestaña de un pilar? (módulo + permiso, y no cedida). */
function isSectionAvailable(
  section: NavSection,
  modules: Has,
  can: (p: Permission) => boolean
): boolean {
  if (!modules.has(section.module)) return false;
  if (section.unless && modules.has(section.unless)) return false;
  return !section.permissions || section.permissions.some((p) => can(p));
}

/** 039 — Las pestañas de un pilar que esta persona puede abrir, en orden. */
export function availableSections(
  def: ModuleDef,
  modules: Has,
  can: (p: Permission) => boolean
): NavSection[] {
  return (def.sections ?? []).filter((s) => isSectionAvailable(s, modules, can));
}

/** ¿`pathname` es `route` o una de sus hijas? */
export function pathWithin(route: string, pathname: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/**
 * 039 — La pestaña activa: la de la ruta MÁS LARGA que contiene a `pathname`
 * (así /campaigns/audiences enciende «Audiencias» y /campaigns/c_1, «Campañas»).
 */
export function activeSection(sections: readonly NavSection[], pathname: string): NavSection | undefined {
  let best: NavSection | undefined;
  let bestLen = -1;
  for (const s of sections) {
    for (const r of [s.route, ...(s.also ?? [])]) {
      if (pathWithin(r, pathname) && r.length > bestLen) {
        best = s;
        bestLen = r.length;
      }
    }
  }
  return best;
}

/**
 * 2026-11 — Qué tan bien una entrada del menú cubre `pathname`: el largo de su
 * ruta más larga que la contiene (0 = no la cubre). La más larga gana, así
 * /lab/documentos es de la Biblioteca y no de Agentes IA (/lab).
 */
export function routeMatchLength(routes: readonly string[], pathname: string): number {
  let best = 0;
  for (const r of routes) if (pathWithin(r, pathname) && r.length > best) best = r.length;
  return best;
}

/** Las rutas que encienden una entrada: su casa y las de sus pestañas. */
export function entryRoutes(def: ModuleDef): string[] {
  return [...(def.route ? [def.route] : []), ...(def.sections ?? []).flatMap((s) => [s.route, ...(s.also ?? [])])];
}

/** 039 — El pilar al que pertenece una ruta (por cualquiera de sus pestañas; la más larga gana). */
export function pillarOfPath(pathname: string): ModuleDef | undefined {
  let best: ModuleDef | undefined;
  let bestLen = 0;
  for (const m of NAV_MODULES) {
    if (!m.sections) continue;
    const len = routeMatchLength(
      m.sections.flatMap((s) => [s.route, ...(s.also ?? [])]),
      pathname
    );
    if (len > bestLen) {
      best = m;
      bestLen = len;
    }
  }
  return best;
}

/**
 * ¿Puede el rol abrir esta entrada? Un pilar, si puede abrir alguna de sus
 * pestañas; una entrada suelta, si su módulo está encendido y tiene el permiso.
 */
export function isAvailable(
  def: ModuleDef,
  modules: ReadonlySet<ModuleKey>,
  can: (p: Permission) => boolean
): boolean {
  if (def.sections) return availableSections(def, modules, can).length > 0;
  if (!modules.has(def.key)) return false;
  return !def.permissions || def.permissions.some((p) => can(p));
}

/** 039 — A dónde lleva el renglón: la primera pestaña que se puede abrir. */
function entryHref(
  def: ModuleDef,
  modules: ReadonlySet<ModuleKey>,
  can: (p: Permission) => boolean
): string {
  return availableSections(def, modules, can)[0]?.route ?? def.route ?? "/";
}

/** El menú de fábrica de un rol: todas las entradas, ocultas las que no son suyas. */
export function defaultLayout(role: Role): NavLayoutItem[] {
  return NAV_MODULES.map((m) => ({ key: m.key, hidden: !m.defaultRoles.includes(role) }));
}

/**
 * Lo guardado, completo y en regla: descarta claves desconocidas o
 * repetidas, agrega en su lugar de fábrica (con su visibilidad de fábrica) las
 * entradas que no estaban —un módulo nuevo—, fuerza visibles las bloqueadas y deja Ajustes
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
  // Una entrada nueva entra en su lugar de fábrica (después de la que la
  // precede en el orden de fábrica), no al final: así un menú guardado antes
  // de 2026-11 recibe Contactos, Agenda y Biblioteca junto a Ventas.
  let prev = -1;
  for (const d of defaults) {
    const at = out.findIndex((i) => i.key === d.key);
    if (at >= 0) {
      prev = at;
      continue;
    }
    out.splice(prev + 1, 0, d);
    prev += 1;
  }
  const fixed = out.map((i) => (isLocked(role, i.key) ? { ...i, hidden: false } : i));
  return [...fixed.filter((i) => !moduleDef(i.key).pinnedBottom), ...fixed.filter((i) => moduleDef(i.key).pinnedBottom)];
}

/**
 * Lo que el servidor le baja al menú (cliente): claves en orden, Ajustes y
 * (039) a dónde lleva cada renglón (la primera pestaña que se puede abrir).
 */
export type NavEntries = { keys: ModuleKey[]; settings: boolean; hrefs?: Partial<Record<ModuleKey, string>> };

export function toNavEntries(nav: ResolvedNav): NavEntries {
  return { keys: nav.main.map((m) => m.key), settings: nav.settings, hrefs: nav.hrefs };
}

export type ResolvedNav = {
  /** Entradas del menú, en orden (sin Ajustes). */
  main: ModuleDef[];
  /** ¿Se pinta Ajustes abajo? */
  settings: boolean;
  /** 039 — A dónde lleva cada renglón. */
  hrefs: Partial<Record<ModuleKey, string>>;
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
  // 039: «Agente» ya no tiene renglón propio — es una pestaña del Estudio de
  // IA (sin Laboratorio, la única). /agent sigue vivo.
  const main = visible.filter((d) => !d.pinnedBottom);
  return {
    main,
    settings: visible.some((d) => d.key === "settings"),
    hrefs: Object.fromEntries(main.map((d) => [d.key, entryHref(d, input.modules, input.can)])),
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

/**
 * 2026-11 — Los títulos de grupo del menú: el grupo con el que arranca cada
 * renglón (o nada). Solo si hay más de un grupo y cada uno queda junto; un
 * menú reordenado a mano que los mezcla va sin títulos.
 */
export function navGroupStarts(keys: readonly ModuleKey[]): (NavGroup | null)[] {
  const groups = keys.map((k) => moduleDef(k).group ?? null);
  const runs: (NavGroup | null)[] = [];
  for (const g of groups) if (runs[runs.length - 1] !== g) runs.push(g);
  const distinct = new Set(runs);
  if (distinct.size < 2 || distinct.size !== runs.length || distinct.has(null)) return keys.map(() => null);
  return groups.map((g, i) => (i === 0 || groups[i - 1] !== g ? g : null));
}
