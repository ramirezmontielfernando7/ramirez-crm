import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, decide, inQuietHours, parseMinutes, parsePrefs, minutesLabel } from "@/lib/notification-prefs";

describe("preferencias de avisos", () => {
  it("lo vacío o roto toma los valores de fábrica", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("no es json")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("[]").tone).toBe("suave");
  });

  it("conserva lo válido y corrige lo inválido", () => {
    const p = parsePrefs(JSON.stringify({ sound: false, tone: "campana", volume: 7, rules: { message: { sound: false } } }));
    expect(p.sound).toBe(false);
    expect(p.tone).toBe("campana");
    expect(p.volume).toBe(1);
    expect(p.rules.message.sound).toBe(false);
    expect(p.rules.message.system).toBe(true);
    expect(parsePrefs(JSON.stringify({ tone: "rara" })).tone).toBe("suave");
  });

  it("«No molestar» cruza la medianoche", () => {
    const quiet = { on: true, from: 20 * 60, to: 8 * 60 };
    expect(inQuietHours(quiet, new Date(2026, 10, 6, 23, 0))).toBe(true);
    expect(inQuietHours(quiet, new Date(2026, 10, 6, 7, 59))).toBe(true);
    expect(inQuietHours(quiet, new Date(2026, 10, 6, 8, 0))).toBe(false);
    expect(inQuietHours(quiet, new Date(2026, 10, 6, 12, 0))).toBe(false);
    expect(inQuietHours({ ...quiet, on: false }, new Date(2026, 10, 6, 23, 0))).toBe(false);
  });

  it("en horario de silencio sigue llegando a Avisos pero sin sonido ni aviso del sistema", () => {
    const prefs = { ...DEFAULT_PREFS, quiet: { on: true, from: 0, to: 1439 } };
    expect(decide("message", prefs, new Date(2026, 10, 6, 12, 0))).toEqual({ inApp: true, sound: false, system: false });
    expect(decide("message", DEFAULT_PREFS, new Date(2026, 10, 6, 12, 0))).toEqual({ inApp: true, sound: true, system: true });
  });

  it("el sonido general apaga todos los sonidos", () => {
    expect(decide("handoff", { ...DEFAULT_PREFS, sound: false }, new Date()).sound).toBe(false);
  });

  it("las horas se leen y se escriben", () => {
    expect(parseMinutes("20:00")).toBe(1200);
    expect(parseMinutes("24:00")).toBeNull();
    expect(minutesLabel(480)).toBe("08:00");
  });
});
