/**
 * 036 (PR 4) — Los interruptores de módulos que ve y edita /platform, en su
 * orden. Son la base del «x/12» de cada organización: los módulos núcleo
 * (Bandeja, Pipeline, Contactos, Ajustes) no se apagan y no cuentan. Puro.
 */
export const PLATFORM_MODULE_TOGGLES = [
  "teamChat",
  "knowledge",
  "results",
  "agent",
  "lab",
  "campaigns",
  "agenda",
  "trabajo",
  "atribucion",
  "instagram",
  "messenger",
  "customNav",
] as const;
export type PlatformModuleToggle = (typeof PLATFORM_MODULE_TOGGLES)[number];

export const PLATFORM_MODULE_LABEL: Record<PlatformModuleToggle, string> = {
  teamChat: "Chat de equipo",
  knowledge: "Conocimientos",
  results: "Resultados",
  agent: "Agente",
  lab: "Laboratorio",
  campaigns: "Campañas",
  agenda: "Citas (Agenda)",
  trabajo: "Tareas y notas",
  atribucion: "Atribución (Meta)",
  instagram: "Instagram",
  messenger: "Messenger",
  customNav: "Menú personalizable",
};

/** Cuántos de los 12 están encendidos. */
export function countActiveModules(modules: Record<PlatformModuleToggle, boolean>): { active: number; total: number } {
  return {
    active: PLATFORM_MODULE_TOGGLES.filter((k) => modules[k]).length,
    total: PLATFORM_MODULE_TOGGLES.length,
  };
}
