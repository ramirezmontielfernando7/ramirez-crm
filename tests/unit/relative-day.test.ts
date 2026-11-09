import { describe, expect, it } from "vitest";
import { agoShort, dayShort } from "@/lib/relative-day";

const now = new Date(2026, 10, 9, 15, 0, 0); // lunes 9 nov 2026, 15:00

describe("agoShort", () => {
  it("hoy en minutos y horas", () => {
    expect(agoShort(new Date(2026, 10, 9, 14, 58).toISOString(), now)).toBe("hace 2 min");
    expect(agoShort(new Date(2026, 10, 9, 12, 0).toISOString(), now)).toBe("hace 3 h");
    expect(agoShort(new Date(2026, 10, 9, 14, 59, 50).toISOString(), now)).toBe("hace un momento");
  });
  it("ayer, día de la semana y fecha", () => {
    expect(agoShort(new Date(2026, 10, 8, 23, 0).toISOString(), now)).toBe("Ayer");
    expect(agoShort(new Date(2026, 10, 5, 10, 0).toISOString(), now)).toBe("Jue");
    expect(agoShort(new Date(2026, 9, 20, 10, 0).toISOString(), now)).toBe("20 oct");
  });
  it("sin fecha", () => {
    expect(agoShort(null, now)).toBe("");
    expect(agoShort("no-es-fecha", now)).toBe("");
  });
});

describe("dayShort", () => {
  it("hoy, ayer y más atrás", () => {
    expect(dayShort(new Date(2026, 10, 9, 1, 0).toISOString(), now)).toBe("Hoy");
    expect(dayShort(new Date(2026, 10, 8, 1, 0).toISOString(), now)).toBe("Ayer");
    expect(dayShort(new Date(2026, 10, 4, 1, 0).toISOString(), now)).toBe("Mié");
    expect(dayShort(new Date(2026, 10, 1, 1, 0).toISOString(), now)).toBe("1 nov");
    expect(dayShort(null, now)).toBe("");
  });
});
