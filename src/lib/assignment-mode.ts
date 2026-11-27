/**
 * Cómo se reparte un lead NUEVO: a mano (llega sin asignar y alguien lo
 * toma o lo reparte) o por turnos entre los asesores (round robin).
 */
export const ASSIGNMENT_MODES = ["manual", "round_robin"] as const;
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];

/**
 * El siguiente en turno: el primero DESPUÉS del último que recibió (`cursor`)
 * en la lista ordenada y estable de elegibles; si el cursor ya no está en la
 * lista (salió del equipo) o es la primera vez, empieza por el primero.
 * Lista vacía = nadie (el lead queda sin asignar).
 */
export function nextInTurn(eligible: readonly string[], cursor: string | null): string | null {
  if (eligible.length === 0) return null;
  const i = cursor ? eligible.indexOf(cursor) : -1;
  return eligible[(i + 1) % eligible.length] ?? null;
}
