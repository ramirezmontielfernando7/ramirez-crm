import { describe, expect, it } from "vitest";
import { isPlanKey, PLAN_KEYS, PLAN_LABEL } from "@/lib/limits";
import { MODULE_PROFILES, PLAN_OPTIONS } from "@/lib/modules/registry";
import { PLATFORM_MODULE_TOGGLES, planKeyOf, planKeyOfModules, planOfModules, planToggles } from "@/lib/platform-modules";

/** 040 — El plan comercial que se GUARDA (`organization_plan.plan_key`): reglas puras. */
describe("plan guardado", () => {
  it("cinco claves con su etiqueta amigable", () => {
    expect([...PLAN_KEYS]).toEqual(["inicio", "esencial", "pro", "ultra", "custom"]);
    expect(PLAN_LABEL).toEqual({ inicio: "Plan Inicio", esencial: "Plan Esencial", pro: "Plan Pro", ultra: "Plan Ultra", custom: "Personalizado" });
    expect(isPlanKey("pro")).toBe(true);
    expect(isPlanKey("personalizado")).toBe(false);
    expect(isPlanKey(null)).toBe(false);
  });

  it("«personalizado» se guarda como `custom`; los demás, tal cual", () => {
    expect(PLAN_OPTIONS.map(planKeyOf)).toEqual(["inicio", "esencial", "pro", "ultra", "custom"]);
  });

  it("la plantilla de cada plan trae sus 13 interruptores y vuelve a su plan", () => {
    for (const p of Object.keys(MODULE_PROFILES) as (keyof typeof MODULE_PROFILES)[]) {
      const t = planToggles(p);
      expect(Object.keys(t).sort()).toEqual([...PLATFORM_MODULE_TOGGLES].sort());
      expect(planOfModules(t)).toBe(p);
      expect(planKeyOfModules(t)).toBe(p);
    }
    expect(planToggles("inicio")).toMatchObject({ agent: false, lab: false, knowledge: false, results: false, trabajo: false, teamChat: true });
    // Esencial: el agente (UN agente con creador) sin el Laboratorio.
    expect(planToggles("esencial")).toMatchObject({ agent: true, lab: false, knowledge: true, teamChat: true });
    // Pro ya no enciende Instagram ni Messenger (fuera de la oferta hasta probarlos).
    expect(planToggles("pro")).toMatchObject({ lab: true, instagram: false, messenger: false });
    expect(planToggles("ultra")).toMatchObject({ campaigns: true, asistente: true });
  });

  it("mover uno solo a mano → `custom`", () => {
    for (const k of PLATFORM_MODULE_TOGGLES) {
      const t = { ...planToggles("pro"), [k]: !planToggles("pro")[k] };
      expect(planKeyOfModules(t)).toBe("custom");
    }
  });
});
