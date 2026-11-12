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
  knowledge: "Biblioteca",
  results: "Resultados",
  agent: "Agentes IA",
  lab: "Agentes IA",
  campaigns: "Campañas",
  agenda: "Agenda",
  trabajo: "Agenda",
  atribucion: "Ajustes",
  instagram: "Bandeja",
  messenger: "Bandeja",
  customNav: "Ajustes",
  asistente: "Asistente",
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
 * 048 — Qué trae cada plan, en los 13 interruptores de /platform. Los de
 * fábrica salen de `MODULE_PROFILES`; el administrador los puede cambiar en
 * «Planes y precios» (`platform_plan_catalog.modules`) y entonces valen los
 * suyos (`mergePlanProfiles`). El Laboratorio solo con el Agente.
 */
export type PlanProfiles = Record<ModuleProfile, Record<PlatformModuleToggle, boolean>>;

function factoryToggles(plan: ModuleProfile): Record<PlatformModuleToggle, boolean> {
  const p = MODULE_PROFILES[plan].modules;
  const out = Object.fromEntries(PLATFORM_MODULE_TOGGLES.map((k) => [k, p[PROFILE_KEY[k]]])) as Record<PlatformModuleToggle, boolean>;
  if (!out.agent) out.lab = false;
  return out;
}

export const FACTORY_PLAN_PROFILES: PlanProfiles = Object.fromEntries(
  (Object.keys(MODULE_PROFILES) as ModuleProfile[]).map((p) => [p, factoryToggles(p)])
) as PlanProfiles;

/** Limpia lo guardado: solo claves conocidas y booleanas; lo que falte, de fábrica. */
export function cleanPlanToggles(raw: unknown, plan: ModuleProfile): Record<PlatformModuleToggle, boolean> {
  const base = { ...FACTORY_PLAN_PROFILES[plan] };
  if (raw && typeof raw === "object") {
    for (const k of PLATFORM_MODULE_TOGGLES) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "boolean") base[k] = v;
    }
  }
  if (!base.agent) base.lab = false;
  return base;
}

/** Los de fábrica con lo guardado encima (sin fila o NULL: los de fábrica). */
export function mergePlanProfiles(overrides: Partial<Record<ModuleProfile, unknown>>): PlanProfiles {
  return Object.fromEntries(
    (Object.keys(MODULE_PROFILES) as ModuleProfile[]).map((p) => [p, overrides[p] == null ? { ...FACTORY_PLAN_PROFILES[p] } : cleanPlanToggles(overrides[p], p)])
  ) as PlanProfiles;
}

/**
 * 039 — ¿A qué plan corresponden HOY los 13 interruptores? Si coinciden
 * exactamente con uno, ese; si alguien movió alguno a mano, «personalizado».
 * 040: lo que sale de aquí se guarda en `organization_plan.plan_key`
 * (`planKeyOfModules`). 048: contra lo que traen los planes HOY (`profiles`).
 */
export function planOfModules(modules: Record<PlatformModuleToggle, boolean>, profiles: PlanProfiles = FACTORY_PLAN_PROFILES): PlanOption {
  for (const plan of Object.keys(MODULE_PROFILES) as ModuleProfile[]) {
    const p = profiles[plan];
    if (PLATFORM_MODULE_TOGGLES.every((k) => modules[k] === p[k])) return plan;
  }
  return "personalizado";
}

/** 040 — La clave que se GUARDA (`organization_plan.plan_key`): «personalizado» → `custom`. */
export function planKeyOf(plan: PlanOption): PlanKey {
  return plan === "personalizado" ? "custom" : plan;
}

/** 040 — El plan guardado que corresponde a estos 13 interruptores. */
export function planKeyOfModules(modules: Record<PlatformModuleToggle, boolean>, profiles: PlanProfiles = FACTORY_PLAN_PROFILES): PlanKey {
  return planKeyOf(planOfModules(modules, profiles));
}

/**
 * 040 — Los 13 interruptores de la plantilla de un plan (los botones
 * «Esencial / Pro / Ultra» del detalle en /platform). El Laboratorio solo con
 * el Agente, como al crear.
 */
export function planToggles(plan: ModuleProfile, profiles: PlanProfiles = FACTORY_PLAN_PROFILES): Record<PlatformModuleToggle, boolean> {
  return { ...profiles[plan] };
}

/* ───────── 048: pantalla de funciones y vista previa del cambio de plan ───────── */

/** Cómo está cada interruptor respecto al plan guardado de la empresa. */
export type FeatureMark = "included" | "extra" | "not_included" | "off";

export const FEATURE_MARK_LABEL: Record<FeatureMark, string> = {
  included: "Incluido en su plan",
  extra: "Extra (fuera de su plan)",
  not_included: "No incluido",
  off: "Apagado (su plan lo trae)",
};

/**
 * - `included`: encendido y su plan lo trae.
 * - `extra`: encendido aunque su plan no lo trae (se lo diste aparte).
 * - `off`: su plan lo trae pero está apagado.
 * - `not_included`: apagado y su plan no lo trae.
 * Sin plan (Personalizado): encendido = incluido, apagado = no incluido.
 */
export function featureMark(key: PlatformModuleToggle, on: boolean, plan: ModuleProfile | null, profiles: PlanProfiles = FACTORY_PLAN_PROFILES): FeatureMark {
  if (!plan) return on ? "included" : "not_included";
  const inPlan = profiles[plan][key];
  if (on) return inPlan ? "included" : "extra";
  return inPlan ? "off" : "not_included";
}

/** De qué depende cada interruptor (lo dice la pantalla). */
export const PLATFORM_MODULE_REQUIRES: Partial<Record<PlatformModuleToggle, PlatformModuleToggle>> = {
  lab: "agent",
};

/** Qué cambia al aplicar la plantilla de un plan: lo que se enciende y lo que se apaga. */
export function planChangeDiff(
  current: Record<PlatformModuleToggle, boolean>,
  target: Record<PlatformModuleToggle, boolean>
): { turnOn: PlatformModuleToggle[]; turnOff: PlatformModuleToggle[] } {
  return {
    turnOn: PLATFORM_MODULE_TOGGLES.filter((k) => !current[k] && target[k]),
    turnOff: PLATFORM_MODULE_TOGGLES.filter((k) => current[k] && !target[k]),
  };
}

/**
 * 048 — El plan más parecido a estos 13 interruptores (el de menos
 * diferencias; a igualdad, el más chico). Con un plan exacto, ese. Sirve para
 * decir «Pro + Campañas como extra» en vez de solo «Personalizado».
 */
export function nearestPlan(modules: Record<PlatformModuleToggle, boolean>, profiles: PlanProfiles = FACTORY_PLAN_PROFILES): { plan: ModuleProfile; diff: number } {
  let best: { plan: ModuleProfile; diff: number } | null = null;
  for (const plan of Object.keys(MODULE_PROFILES) as ModuleProfile[]) {
    const diff = PLATFORM_MODULE_TOGGLES.filter((k) => modules[k] !== profiles[plan][k]).length;
    if (!best || diff < best.diff) best = { plan, diff };
  }
  return best!;
}
