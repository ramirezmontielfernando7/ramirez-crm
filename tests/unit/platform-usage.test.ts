import { describe, expect, it } from "vitest";
import { countActiveModules, PLATFORM_MODULE_LABEL, PLATFORM_MODULE_TOGGLES } from "@/lib/platform-modules";
import { aiMeter, formatTokens, meterTone, storageMeter } from "@/lib/usage";

/** 036 (PR 4) — Medidores y «x/12» de la lista de /platform (reglas puras). */
describe("medidores de /platform", () => {
  it("formatTokens compacto en es-MX", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_345)).toBe("12.3 k");
    expect(formatTokens(1_234_567)).toBe("1.2 M");
    expect(formatTokens(-3)).toBe("0");
  });

  it("tono: normal < 80 % ≤ aviso < 100 % ≤ rojo; sin tope, normal", () => {
    expect(meterTone(null)).toBe("normal");
    expect(meterTone(0.79)).toBe("normal");
    expect(meterTone(0.8)).toBe("warning");
    expect(meterTone(1)).toBe("danger");
    expect(meterTone(1.4)).toBe("danger");
  });

  it("IA sin topes: tokens y «sin tope», sin barra", () => {
    const m = aiMeter({ turns: 3, tokens: 1500 }, { turns: null, tokens: null });
    expect(m).toMatchObject({ text: "1.5 k tokens · sin tope", ratio: null, tone: "normal" });
    expect(m.detail).toContain("3 turnos");
  });

  it("IA con tope de tokens: tokens usados / tope", () => {
    const m = aiMeter({ turns: 10, tokens: 4_000_000 }, { turns: null, tokens: 5_000_000 });
    expect(m.text).toBe("4 M / 5 M tokens");
    expect(m.ratio).toBeCloseTo(0.8);
    expect(m.tone).toBe("warning");
  });

  it("IA con dos topes: muestra el que va más alto (el que frena primero)", () => {
    const porTurnos = aiMeter({ turns: 95, tokens: 1000 }, { turns: 100, tokens: 1_000_000 });
    expect(porTurnos.text).toBe("95 / 100 turnos");
    expect(porTurnos.tone).toBe("warning");
    const porTokens = aiMeter({ turns: 1, tokens: 900_000 }, { turns: 100, tokens: 1_000_000 });
    expect(porTokens.text).toBe("900 k / 1 M tokens");
    expect(porTokens.detail).toContain("1 / 100 turnos");
  });

  it("IA con tope en cero: rojo (no entra ningún turno)", () => {
    expect(aiMeter({ turns: 0, tokens: 0 }, { turns: 0, tokens: null }).tone).toBe("danger");
  });

  it("almacenamiento: hasta el PR 3 no hay tope", () => {
    expect(storageMeter(3.4 * 1024 ** 2)).toMatchObject({ text: "3.4 MB · sin tope", ratio: null, tone: "normal" });
    expect(storageMeter(900, 1000)).toMatchObject({ ratio: 0.9, tone: "warning" });
  });

  it("«x/12»: los 12 interruptores de /platform, Menú personalizable incluido", () => {
    expect(PLATFORM_MODULE_TOGGLES).toHaveLength(12);
    expect(PLATFORM_MODULE_TOGGLES).toContain("customNav");
    for (const k of PLATFORM_MODULE_TOGGLES) expect(PLATFORM_MODULE_LABEL[k].length).toBeGreaterThan(3);
    const todo = Object.fromEntries(PLATFORM_MODULE_TOGGLES.map((k) => [k, true])) as Record<(typeof PLATFORM_MODULE_TOGGLES)[number], boolean>;
    expect(countActiveModules(todo)).toEqual({ active: 12, total: 12 });
    expect(countActiveModules({ ...todo, campaigns: false, customNav: false, instagram: false })).toEqual({ active: 9, total: 12 });
  });
});
