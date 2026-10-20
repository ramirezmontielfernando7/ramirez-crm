/**
 * 042 — Interruptores de los agentes de IA: la regla pura.
 *
 * Hay dos: el GENERAL de la organización (`agent_profile.paused_at`, el freno
 * de emergencia) y uno por agente (`agent.paused_at`). Con cualquiera
 * activado, un chat real que el agente iba a atender NO se queda callado: pasa
 * a atención humana (handoff con motivo `pausa`), como cualquier otro traspaso.
 * Las conversaciones del Laboratorio (`isTest`) no se pausan: es el sandbox
 * donde se prueba un agente antes de encenderlo.
 */

export type PauseState = {
  /** Pausa general de la organización. */
  orgPausedAt: Date | null;
  /** Interruptor del agente que atendería (el general, el de la etapa…). */
  agentPausedAt: Date | null;
};

/** Quién detuvo el turno: la organización entera o solo ese agente. */
export type PauseScope = "org" | "agent";

/** La pausa general manda sobre la de un agente (es la que el equipo ve primero). */
export function pauseScope(state: PauseState): PauseScope | null {
  if (state.orgPausedAt) return "org";
  if (state.agentPausedAt) return "agent";
  return null;
}

/** ¿Este turno debe pasar a una persona en vez de responder el agente? */
export function turnIsPaused(state: PauseState, isTest: boolean): boolean {
  return !isTest && pauseScope(state) !== null;
}

export const PAUSE_HANDOFF_REASON = "pausa" as const;

/** Textos para el equipo (Bandeja, línea de tiempo, Estudio de IA). */
export const PAUSE_LABEL = {
  handoff: "Agentes de IA en pausa",
  banner: "Los agentes de IA están en pausa",
  bannerBody:
    "No responden a ningún cliente: los chats nuevos pasan a atención humana. Tu configuración sigue intacta.",
} as const;
