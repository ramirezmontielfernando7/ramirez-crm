/**
 * 022 — Preferencias de interfaz por usuario. Pura: la usan el layout (en el
 * servidor, para pintar sin parpadeo) y el cliente.
 */

/**
 * ¿El lateral arranca colapsado? Lo guardado gana; sin nada guardado, el
 * default del rol: el Asesor trabaja casi solo en la Bandeja y arranca
 * colapsado; quien reparte y mide arranca con el menú abierto.
 */
export function resolveNavCollapsed(saved: boolean | null | undefined, role: string): boolean {
  if (typeof saved === "boolean") return saved;
  return role === "asesor";
}
