import { describe, expect, it } from "vitest";
import { cleanStopKeywords, DEFAULT_STOP_KEYWORDS, matchStopKeyword, normalizeKeyword } from "@/lib/opt-out";

describe("baja por palabra clave (Campañas v2)", () => {
  it("normaliza mayúsculas, acentos, puntuación y emojis", () => {
    expect(normalizeKeyword("  ¡BAJA! 🙏 ")).toBe("baja");
    expect(normalizeKeyword("Dár de   baja.")).toBe("dar de baja");
  });

  it("coincide solo con el mensaje COMPLETO", () => {
    expect(matchStopKeyword("BAJA", DEFAULT_STOP_KEYWORDS)).toBe("baja");
    expect(matchStopKeyword("Stop.", DEFAULT_STOP_KEYWORDS)).toBe("stop");
    expect(matchStopKeyword("Darme de baja por favor", DEFAULT_STOP_KEYWORDS)).toBeNull();
    expect(matchStopKeyword("no me des de baja", DEFAULT_STOP_KEYWORDS)).toBeNull();
    expect(matchStopKeyword("quiero cancelar mi cita", DEFAULT_STOP_KEYWORDS)).toBeNull();
    expect(matchStopKeyword("", DEFAULT_STOP_KEYWORDS)).toBeNull();
    expect(matchStopKeyword(null, DEFAULT_STOP_KEYWORDS)).toBeNull();
  });

  it("los defaults no incluyen palabras que un cliente usa para otra cosa", () => {
    expect(DEFAULT_STOP_KEYWORDS).not.toContain("cancelar");
    expect(DEFAULT_STOP_KEYWORDS).not.toContain("alto");
  });

  it("cada organización puede usar sus propias palabras", () => {
    expect(matchStopKeyword("Cancelar", ["cancelar"])).toBe("cancelar");
    expect(matchStopKeyword("baja", ["cancelar"])).toBeNull();
  });

  it("limpia la lista de Ajustes: normaliza, quita vacías y repetidas", () => {
    expect(cleanStopKeywords(["BAJA", " baja ", "", "Stop!"])).toEqual({ keywords: ["baja", "stop"] });
    expect(cleanStopKeywords(["x".repeat(41)])).toHaveProperty("error");
    expect(cleanStopKeywords(Array.from({ length: 31 }, (_, i) => `p${i}`))).toHaveProperty("error");
  });
});
