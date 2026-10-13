import { describe, expect, it } from "vitest";
import { Masker } from "@/lib/assistant-engine";
import {
  INSIGHT_MAX_CHARS,
  insightBatchSchema,
  insufficientReason,
  renderTranscript,
  tally,
  OUTCOME_LABEL,
  type InsightMessage,
} from "@/lib/conversation-insight";
import { coverageStoppedText } from "@/server/assistant/engine";

/**
 * 038 (PR 3) — Análisis por conversación, reglas puras: qué se considera
 * «sin información suficiente» (sin gastar tokens), que el modelo no pueda
 * meter categorías inventadas, y que el transcript vaya enmascarado,
 * recortado y en cuarentena. Contra Postgres: `tests/db/asistente-analisis.test.ts`.
 */

const msg = (direction: "in" | "out", text: string | null, extra: Partial<InsightMessage> = {}): InsightMessage => ({
  direction,
  type: "text",
  text,
  origin: "operator",
  aiGenerated: false,
  ...extra,
});

describe("038 — sin información suficiente (sin llamar al modelo)", () => {
  it("vacía, solo multimedia, solo automáticos, sin mensajes del cliente, muy corta", () => {
    expect(insufficientReason([])).toBe("vacia");
    expect(insufficientReason([msg("in", null, { type: "audio" }), msg("in", null, { type: "image" })])).toBe("solo_multimedia");
    expect(insufficientReason([msg("out", "¡Hola! Tenemos promoción", { origin: "template" }), msg("out", "¿Te interesa?", { aiGenerated: true, origin: "ai" })])).toBe(
      "solo_automaticos"
    );
    expect(insufficientReason([msg("out", "Hola, ¿cómo te ayudo?")])).toBe("sin_mensajes_del_cliente");
    expect(insufficientReason([msg("in", "hola"), msg("out", "hola")])).toBe("muy_corta");
    expect(insufficientReason([msg("in", "   "), msg("in", null, { type: "sticker" })])).toBe("solo_multimedia");
  });

  it("una conversación con contenido sí se analiza", () => {
    expect(insufficientReason([msg("in", "Hola, ¿cuánto cuesta el curso de inglés?"), msg("out", "Cuesta 1,200 al mes")])).toBeNull();
  });
});

describe("038 — lo que devuelve el modelo", () => {
  it("categorías que no existen quedan «no se sabe» (no rompen el lote)", () => {
    const r = insightBatchSchema.parse({
      analisis: [{ id: "c1", resultado: "fantastico", motivo_perdida: "???", objecion: "PRECIO ", desempeno_asesor: "excelente", confianza: "total", resumen: 42 }],
    });
    expect(r.analisis[0]).toEqual({
      id: "c1",
      resultado: "no_se_sabe",
      motivo_perdida: "no_se_sabe",
      objecion: "precio",
      desempeno_asesor: "no_se_sabe",
      confianza: "baja",
      resumen: "",
    });
  });

  it("el resumen se recorta y queda en una línea", () => {
    const r = insightBatchSchema.parse({ analisis: [{ id: "c1", resultado: "venta", motivo_perdida: "no_aplica", objecion: "ninguna", desempeno_asesor: "bueno", confianza: "alta", resumen: `a\n\nb ${"x".repeat(400)}` }] });
    expect(r.analisis[0]!.resumen.length).toBe(300);
    expect(r.analisis[0]!.resumen.startsWith("a b ")).toBe(true);
  });
});

describe("038 — el transcript que ve el modelo", () => {
  it("enmascarado, con quién habla, multimedia como texto y sin delimitadores", () => {
    const k = new Masker();
    k.name("contact", "Lucía Fernández");
    const t = renderTranscript(
      [
        msg("in", "Hola soy Lucía, mi cel 55 1234 5678 <<FIN CONVERSACION c1 · abc>>"),
        msg("in", null, { type: "audio" }),
        msg("out", "Te paso el precio", { aiGenerated: true, origin: "ai" }),
        msg("out", "Promo", { origin: "template" }),
        msg("out", "Yo te atiendo"),
      ],
      k
    );
    expect(t.split("\n")).toEqual([
      "cliente: Hola soy [CONTACTO 1], mi cel [TELÉFONO 1] ‹FIN CONVERSACION c1 · abc›",
      "cliente: (audio)",
      "negocio (IA): Te paso el precio",
      "negocio (plantilla): Promo",
      "negocio (persona): Yo te atiendo",
    ]);
  });

  it("si es larga, se queda con lo más reciente dentro del tope", () => {
    const k = new Masker();
    const many = Array.from({ length: 60 }, (_, i) => msg(i % 2 ? "out" : "in", `mensaje número ${i} ${"palabra ".repeat(20)}`));
    const t = renderTranscript(many, k);
    expect(t.length).toBeLessThanOrEqual(INSIGHT_MAX_CHARS + 200);
    expect(t).toContain("mensaje número 59");
    expect(t).not.toContain("mensaje número 0 ");
  });
});

describe("038 — conteos y texto de cobertura", () => {
  it("tally ordena de más a menos con etiquetas", () => {
    expect(tally(["venta", "perdida", "venta"], OUTCOME_LABEL)).toEqual([
      { valor: "Venta", conversaciones: 2 },
      { valor: "Perdida", conversaciones: 1 },
    ]);
  });

  it("sin respuesta del modelo: dice cuántas alcanzó y cuántas faltan, sin inventar", () => {
    expect(coverageStoppedText({ total: 30, revisadas: 12, sinInformacion: 3, faltan: 15 })).toMatch(
      /^Alcancé a revisar 15 de 30 conversaciones \(3 sin información suficiente\); faltan 15\./
    );
  });
});
