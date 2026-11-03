import { describe, expect, it } from "vitest";
import { sanitizeQuickReplies, sanitizeUpdates, wordDiff, CREATOR_FIELD_MAX } from "@/lib/agent-creator";

const empty = { displayName: null, tone: null, greeting: null, instructions: null, escalationRules: null };

describe("creador del agente — reglas puras", () => {
  it("descarta campos desconocidos, vacíos, repetidos sin cambio y textos que pasan el tope", () => {
    const out = sanitizeUpdates(
      [
        { field: "instructions", value: "  Eres el asistente de Sonrisa.  " },
        { field: "hacker", value: "x" },
        { field: "tone", value: "   " },
        { field: "greeting", value: "x".repeat(CREATOR_FIELD_MAX.greeting + 1) },
        { field: "displayName", value: "Ana" },
      ],
      { ...empty, displayName: "Ana" }
    );
    expect(out).toEqual([{ field: "instructions", value: "Eres el asistente de Sonrisa." }]);
  });
  it("uno por campo: gana el último", () => {
    const out = sanitizeUpdates([{ field: "tone", value: "a" }, { field: "tone", value: "b" }], empty);
    expect(out).toEqual([{ field: "tone", value: "b" }]);
  });
  it("limita las respuestas rápidas", () => {
    expect(sanitizeQuickReplies(["a", " ", "b", "c", "d", "e"])).toEqual(["a", "b", "c", "d"]);
  });
  it("wordDiff marca lo quitado y lo agregado", () => {
    expect(wordDiff("No des precios. Sé amable.", "Da el rango de precios. Sé amable.")).toEqual([
      { kind: "del", text: "No des" },
      { kind: "ins", text: "Da el rango de" },
      { kind: "same", text: "precios. Sé amable." },
    ]);
    expect(wordDiff("igual", "igual")).toEqual([{ kind: "same", text: "igual" }]);
  });
});
