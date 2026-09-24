/**
 * 020 — Quién recibe un lead NUEVO.
 *
 * Hoy solo existe el reparto `manual`: todo lead llega "sin asignar" y el
 * Coordinador o el Propietario lo reparte. El diseño deja el enchufe listo
 * para un reparto automático (round-robin) sin tocar a quien crea leads:
 *
 * 1. Implementar `AssignmentStrategy` (p. ej. `roundRobin`), leyendo
 *    `assignment_settings.mode` y avanzando `cursor_user_id` con un
 *    `select … for update` para que dos leads simultáneos no caigan en la
 *    misma persona.
 * 2. Devolverla en `strategyFor()` cuando el modo lo pida.
 * 3. `createLeadForContact` ya la consulta y, si devuelve alguien, asigna por
 *    la única puerta (`assignContacts`, `source: "auto"`).
 */
export type AssignmentStrategy = {
  name: "manual" | "round_robin";
  /** userId que recibe el lead, o null = sin asignar. */
  pick(input: { organizationId: string; contactId: string }): Promise<string | null>;
};

export const manualStrategy: AssignmentStrategy = {
  name: "manual",
  pick: async () => null,
};

export async function strategyFor(
  _organizationId: string
): Promise<AssignmentStrategy> {
  return manualStrategy;
}
