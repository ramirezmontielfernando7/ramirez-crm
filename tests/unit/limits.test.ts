import { describe, expect, it } from "vitest";
import {
  alertText,
  ALERT_METRIC_LABEL,
  ALERT_METRICS,
  crossedThresholds,
  LIMIT_MESSAGES,
  PLAN_LABEL,
  resolveLimit,
  STORAGE_MODE_LABEL,
} from "@/lib/limits";

/** 036 (PR 3a) — Reglas puras de límites y avisos. */
describe("límites", () => {
  it("un tope: propio > entorno > sin tope", () => {
    expect(resolveLimit(10, 99)).toEqual({ value: 10, source: "org" });
    expect(resolveLimit(0, 99)).toEqual({ value: 0, source: "org" });
    expect(resolveLimit(null, 99)).toEqual({ value: 99, source: "env" });
    expect(resolveLimit(undefined, undefined)).toEqual({ value: null, source: "none" });
  });

  it("plan «Personalizado» y los dos modos de almacenamiento", () => {
    expect(PLAN_LABEL.custom).toBe("Personalizado");
    expect(STORAGE_MODE_LABEL).toEqual({ warn: "Solo avisar", block_uploads: "Bloquear subidas manuales" });
  });
});

describe("avisos al 80 % y 100 %", () => {
  it("cruza 80 % y 100 % justo en el umbral", () => {
    expect(crossedThresholds(79, 100)).toEqual([]);
    expect(crossedThresholds(80, 100)).toEqual([80]);
    expect(crossedThresholds(99, 100)).toEqual([80]);
    expect(crossedThresholds(100, 100)).toEqual([80, 100]);
    expect(crossedThresholds(250, 100)).toEqual([80, 100]);
  });

  it("sin tope, o tope 0, no avisa", () => {
    expect(crossedThresholds(1_000_000, null)).toEqual([]);
    expect(crossedThresholds(5, 0)).toEqual([]);
  });

  it("textos claros para el Propietario, de cada medida", () => {
    expect(alertText("storage", 80)).toBe("Tu organización va en el 80 % del tope de almacenamiento (aprox.).");
    expect(alertText("ai_tokens", 100)).toBe("Tu organización llegó al tope de tokens de IA del mes.");
    for (const m of ALERT_METRICS) expect(ALERT_METRIC_LABEL[m].length).toBeGreaterThan(5);
  });

  it("mensajes de rechazo: dicen qué pasó y qué hacer", () => {
    expect(LIMIT_MESSAGES.storage).toMatch(/no se puede subir/);
    expect(LIMIT_MESSAGES.members).toMatch(/tope de personas/);
    expect(LIMIT_MESSAGES.modules).toMatch(/apaga otro/);
  });
});
