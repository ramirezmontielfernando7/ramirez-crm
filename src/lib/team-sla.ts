/** Minutos que se le da a un asesor para contestar antes de contarlo como «tarde». */
export const DEFAULT_TEAM_SLA_MINUTES = 5;
export const MIN_TEAM_SLA_MINUTES = 1;
export const MAX_TEAM_SLA_MINUTES = 1440;

export function normalizeTeamSla(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TEAM_SLA_MINUTES;
  return Math.min(MAX_TEAM_SLA_MINUTES, Math.max(MIN_TEAM_SLA_MINUTES, Math.round(n)));
}
