import { describe, expect, it } from "vitest";
import { assistantMessage, ASSISTANT_COST_NOTICE, nextResetDate, resetLabel } from "@/lib/assistant";
import { alertText, isUsageVisibility } from "@/lib/limits";
import { MODULE_PROFILES, moduleDef } from "@/lib/modules/registry";
import { gaugeMeter, gaugeState, projectGauge, projectShares, worstGauge } from "@/lib/usage-visibility";
import { NEW_MODULE_DEFAULTS } from "@/server/modules/defaults";
import { QUOTA_DETAIL } from "@/server/ai-quota/llm";

/**
 * 038 (PR 1) — Base del asistente interno, reglas puras: qué ve el cliente de
 * su consumo según la visibilidad, los textos de los avisos y del asistente, y
 * que el módulo nace apagado. Lo que pasa en la BD lo prueba
 * `tests/db/asistente-base.test.ts`.
 */

describe("038 — visibilidad del consumo", () => {
  it("estado: sin tope disponible, desde 80 % queda poco, al tope agotado; tope 0 = agotado", () => {
    expect(gaugeState(10, null)).toBe("available");
    expect(gaugeState(79, 100)).toBe("available");
    expect(gaugeState(80, 100)).toBe("near");
    expect(gaugeState(100, 100)).toBe("exhausted");
    expect(gaugeState(0, 0)).toBe("exhausted");
  });

  it("`percent`: solo porcentaje; `status`: sin números (queda poco = disponible); `tokens`: las cifras", () => {
    expect(projectGauge("percent", 850, 1000)).toEqual({ state: "near", percent: 85 });
    expect(projectGauge("status", 850, 1000)).toEqual({ state: "available", percent: null });
    expect(projectGauge("status", 1000, 1000)).toEqual({ state: "exhausted", percent: null });
    expect(projectGauge("tokens", 850, 1000)).toEqual({ state: "near", percent: 85, used: 850, limit: 1000 });
    expect(projectGauge("percent", 5, null)).toEqual({ state: "available", percent: null });
  });

  it("de turnos y tokens, frena primero la que va peor", () => {
    const tokens = projectGauge("percent", 90, 100);
    const turnos = projectGauge("percent", 3, 10);
    expect(worstGauge(turnos, tokens)).toEqual(tokens);
    expect(worstGauge(projectGauge("percent", 10, 10), tokens).state).toBe("exhausted");
  });

  it("el medidor sin cifras: porcentaje del tope, o solo el estado", () => {
    expect(gaugeMeter({ state: "near", percent: 85 }).text).toBe("85 % del tope");
    expect(gaugeMeter({ state: "available", percent: null }).text).toBe("Disponible");
    const agotado = gaugeMeter({ state: "exhausted", percent: null });
    expect(agotado).toMatchObject({ text: "Agotado", tone: "danger", ratio: null });
  });

  it("el desglose: parte del total; cifras solo con `tokens`; sin desglose con `status`", () => {
    const filas = [
      { key: "agent", tokens: 300, turns: 3 },
      { key: "writing", tokens: 100, turns: 1 },
    ];
    expect(projectShares("percent", filas)).toEqual([
      { key: "agent", share: 0.75 },
      { key: "writing", share: 0.25 },
    ]);
    expect(projectShares("tokens", filas)?.[0]).toEqual({ key: "agent", share: 0.75, tokens: 300, turns: 3 });
    expect(projectShares("status", filas)).toBeNull();
  });

  it("solo tres valores válidos", () => {
    for (const v of ["percent", "status", "tokens"]) expect(isUsageVisibility(v)).toBe(true);
    expect(isUsageVisibility("usd")).toBe(false);
  });
});

describe("038 — avisos de consumo según la visibilidad", () => {
  it("con `tokens`, el texto de siempre", () => {
    expect(alertText("ai_tokens", 80)).toBe("Tu organización va en el 80 % del tope de tokens de IA del mes.");
    expect(alertText("assistant_tokens", 100, "tokens")).toBe("Tu organización llegó al tope de tokens del asistente interno del mes.");
  });

  it("con `percent`, sin la palabra «tokens»", () => {
    expect(alertText("ai_tokens", 80, "percent")).toBe("Tu organización va en el 80 % de su IA del mes.");
    expect(alertText("ai_turns", 100, "percent")).toBe("Tu organización agotó su IA del mes.");
    expect(alertText("assistant_tokens", 80, "percent")).toBe("Tu organización va en el 80 % de su crédito del asistente interno.");
  });

  it("con `status`, ni un número", () => {
    expect(alertText("ai_tokens", 80, "status")).toBe("A tu organización le queda poco de su IA del mes.");
    expect(alertText("assistant_tokens", 100, "status")).toBe("Tu organización agotó su crédito del asistente interno.");
    for (const m of ["ai_tokens", "ai_turns", "embed_tokens", "assistant_tokens"] as const) {
      for (const t of [80, 100] as const) expect(alertText(m, t, "status")).not.toMatch(/\d|token/);
    }
  });

  it("las medidas que no son de IA no cambian", () => {
    expect(alertText("members", 100, "status")).toBe("Tu organización llegó al tope de personas del equipo.");
  });
});

describe("038 — el asistente", () => {
  it("el módulo nace apagado: sin variable de entorno ni perfil de alta que lo encienda", () => {
    expect(NEW_MODULE_DEFAULTS.asistente).toBe(false);
    for (const p of Object.values(MODULE_PROFILES)) expect(p.modules).not.toHaveProperty("asistente");
    const def = moduleDef("asistente");
    expect(def).toMatchObject({ route: "/asistente", core: false, defaultRoles: ["owner"], permissions: ["assistant.use"] });
  });

  it("el aviso dice que consume bastante crédito y que se puede agotar rápido", () => {
    expect(ASSISTANT_COST_NOTICE).toMatch(/consume bastante crédito de IA/);
    expect(ASSISTANT_COST_NOTICE).toMatch(/agotar rápido/);
    expect(ASSISTANT_COST_NOTICE).not.toMatch(/\$|USD|token/i);
  });

  it("se renueva el primer día del mes siguiente (UTC)", () => {
    expect(nextResetDate(new Date("2026-10-31T23:59:00Z"))).toBe("2026-11-01");
    expect(nextResetDate(new Date("2026-12-15T00:00:00Z"))).toBe("2027-01-01");
    expect(resetLabel("2026-11-01")).toBe("1 de noviembre");
  });

  it("cada estado tiene un mensaje claro, sin cifras ni dólares", () => {
    expect(assistantMessage("exhausted", "2026-11-01")).toBe(
      "El asistente agotó su crédito de este mes y se detuvo. Vuelve a estar disponible el 1 de noviembre. Si necesitas más, habla con quien administra la plataforma."
    );
    expect(assistantMessage("unset", "2026-11-01")).toMatch(/aún no tiene un crédito asignado/);
    expect(assistantMessage("ai_exhausted", "2026-11-01")).toMatch(/IA de tu organización llegó a su tope/);
    for (const s of ["available", "exhausted", "ai_exhausted", "unset", "not_configured"] as const) {
      expect(assistantMessage(s, "2026-11-01")).not.toMatch(/\$|USD|token/i);
    }
  });

  it("el rechazo del modelo dice si fue el tope del asistente o que no tiene tope", () => {
    expect(QUOTA_DETAIL.assistant_tokens).toBe("tope mensual del asistente interno alcanzado");
    expect(QUOTA_DETAIL.assistant_unset).toBe("el asistente interno no tiene tope asignado");
  });
});
