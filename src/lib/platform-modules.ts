import type { PlanKey } from "@/lib/limits";
import { MODULE_PROFILES, type ModuleProfile, type PlanOption, type ProfileModules } from "@/lib/modules/registry";

/**
 * 036 (PR 4) — Los interruptores de módulos que ve y edita /platform, en su
 * orden. Son la base del «x/13» de cada organización: los módulos núcleo
 * (Bandeja, Pipeline, Contactos, Ajustes) no se apagan y no cuentan. Puro.
 * 038 (PR 1): el 13.º, Asistente interno (premium, apagado por defecto).
 * 039: los planes comerciales (Esencial, Pro, Ultra) son plantillas de estos 13.
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
  "asistente",
] as const;
export type PlatformModuleToggle = (typeof PLATFORM_MODULE_TOGGLES)[number];

export const PLATFORM_MODULE_LABEL: Record<PlatformModuleToggle, string> = {
  teamChat: "Chat de equipo",
  knowledge: "Biblioteca (Conocimientos)",
  results: "Resultados",
  agent: "Agente de IA",
  lab: "Laboratorio (varios agentes)",
  campaigns: "Campañas masivas",
  agenda: "Agenda (Citas)",
  trabajo: "Tareas y notas",
  atribucion: "Atribución (Meta CAPI)",
  instagram: "Instagram",
  messenger: "Messenger",
  customNav: "Menú personalizable",
  asistente: "Asistente interno del dueño",
};

/**
 * 039 — En qué pilar del menú vive cada interruptor (para que /platform diga
 * qué ve el negocio al encenderlo). Los canales y la atribución viven en
 * Ajustes → Canales y Meta.
 */
export const PLATFORM_MODULE_PILLAR: Record<PlatformModuleToggle, string> = {
  teamChat: "Bandeja",
  knowledge: "CRM Comercial",
  results: "Inteligencia",
  agent: "Estudio de IA",
  lab: "Estudio de IA",
  campaigns: "Marketing",
  agenda: "CRM Comercial",
  trabajo: "CRM Comercial",
  atribucion: "Ajustes",
  instagram: "Bandeja",
  messenger: "Bandeja",
  customNav: "Ajustes",
  asistente: "Inteligencia",
};

/** Cuántos de los 13 están encendidos. */
export function countActiveModules(modules: Record<PlatformModuleToggle, boolean>): { active: number; total: number } {
  return {
    active: PLATFORM_MODULE_TOGGLES.filter((k) => modules[k]).length,
    total: PLATFORM_MODULE_TOGGLES.length,
  };
}

/** El interruptor de /platform para cada clave de los planes (`MODULE_PROFILES`). */
const PROFILE_KEY: Record<PlatformModuleToggle, keyof ProfileModules> = {
  teamChat: "team_chat",
  knowledge: "knowledge",
  results: "results",
  agent: "agent",
  lab: "lab",
  campaigns: "campaigns",
  agenda: "agenda",
  trabajo: "trabajo",
  atribucion: "atribucion",
  instagram: "instagram",
  messenger: "messenger",
  customNav: "customNav",
  asistente: "asistente",
};

/**
 * 039 — ¿A qué plan corresponden HOY los 13 interruptores? Si coinciden
 * exactamente con uno, ese; si alguien movió alguno a mano, «personalizado».
 * 040: lo que sale de aquí se guarda en `organization_plan.plan_key`
 * (`planKeyOfModules`).
 */
export function planOfModules(modules: Record<PlatformModuleToggle, boolean>): PlanOption {
  for (const plan of Object.keys(MODULE_PROFILES) as ModuleProfile[]) {
    const p = MODULE_PROFILES[plan].modules;
    if (PLATFORM_MODULE_TOGGLES.every((k) => modules[k] === p[PROFILE_KEY[k]])) return plan;
  }
  return "personalizado";
}

/** 040 — La clave que se GUARDA (`organization_plan.plan_key`): «personalizado» → `custom`. */
export function planKeyOf(plan: PlanOption): PlanKey {
  return plan === "personalizado" ? "custom" : plan;
}

/** 040 — El plan guardado que corresponde a estos 13 interruptores. */
export function planKeyOfModules(modules: Record<PlatformModuleToggle, boolean>): PlanKey {
  return planKeyOf(planOfModules(modules));
}

/**
 * 040 — Los 13 interruptores de la plantilla de un plan (los botones
 * «Esencial / Pro / Ultra» del detalle en /platform). El Laboratorio solo con
 * el Agente, como al crear.
 */
export function planToggles(plan: ModuleProfile): Record<PlatformModuleToggle, boolean> {
  const p = MODULE_PROFILES[plan].modules;
  const out = Object.fromEntries(PLATFORM_MODULE_TOGGLES.map((k) => [k, p[PROFILE_KEY[k]]])) as Record<PlatformModuleToggle, boolean>;
  if (!out.agent) out.lab = false;
  return out;
}
