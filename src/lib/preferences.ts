/**
 * 022 — Preferencias de interfaz por usuario. Pura: la usan el layout (en el
 * servidor, para pintar sin parpadeo) y el cliente.
 */

/**
 * Los tres estados del menú lateral en escritorio, en el orden del ciclo del
 * hamburguesa: expandido → solo íconos → oculto → expandido. En el teléfono
 * no aplican: ahí el menú es un cajón que abre y cierra.
 */
export const NAV_MODES = ["expanded", "collapsed", "hidden"] as const;
export type NavMode = (typeof NAV_MODES)[number];

export function isNavMode(value: unknown): value is NavMode {
  return typeof value === "string" && (NAV_MODES as readonly string[]).includes(value);
}

/** El que sigue en el ciclo del botón. */
export function nextNavMode(mode: NavMode): NavMode {
  return NAV_MODES[(NAV_MODES.indexOf(mode) + 1) % NAV_MODES.length] ?? "expanded";
}

/**
 * ¿En qué estado arranca el lateral? Lo guardado gana: primero el modo de
 * tres estados; si solo hay la preferencia vieja de dos (`navCollapsed`), se
 * traduce. Sin nada guardado, el default del rol: el Asesor trabaja casi solo
 * en la Bandeja y arranca colapsado; quien reparte y mide, con el menú abierto.
 */
export function resolveNavMode(
  saved: { navMode?: string | null; navCollapsed?: boolean | null } | null | undefined,
  role: string
): NavMode {
  if (isNavMode(saved?.navMode)) return saved.navMode;
  if (typeof saved?.navCollapsed === "boolean") {
    return saved.navCollapsed ? "collapsed" : "expanded";
  }
  return role === "asesor" ? "collapsed" : "expanded";
}

/** Compatibilidad: ¿arranca colapsado (o más)? Equivale a la regla de dos estados. */
export function resolveNavCollapsed(saved: boolean | null | undefined, role: string): boolean {
  return resolveNavMode({ navCollapsed: saved }, role) !== "expanded";
}
