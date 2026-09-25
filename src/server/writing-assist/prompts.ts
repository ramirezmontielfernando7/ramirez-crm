import { z } from "zod";
import type { ChatMessage } from "@/lib/ai";

/**
 * 023 — Asistente de redacción del asesor.
 *
 * Es una IA APARTE del agente (`src/server/ai/`): no lee la conversación, no
 * mueve el pipeline ni traspasa. Solo reescribe el borrador que el asesor le
 * da. Comparte con el agente únicamente el adaptador (`chatJson`) y su
 * configuración `OPENROUTER_*`.
 */

/** Marca del prompt: el ai-mock despacha por ella en el self-test. */
export const WRITING_ASSIST_MARKER = "[VOCERO-ASISTENTE-REDACCION]";

export const WRITING_ACTIONS = [
  "improve",
  "tone",
  "summarize",
  "shorten",
  "lengthen",
] as const;
export type WritingAction = (typeof WRITING_ACTIONS)[number];

export const WRITING_TONES = ["formal", "casual", "empatico"] as const;
export type WritingTone = (typeof WRITING_TONES)[number];

/** Tope del borrador: un mensaje de WhatsApp largo, no un documento. */
export const WRITING_MAX_CHARS = 4000;

export const writingRequestSchema = z
  .object({
    action: z.enum(WRITING_ACTIONS),
    tone: z.enum(WRITING_TONES).optional(),
    text: z.string().trim().min(1).max(WRITING_MAX_CHARS),
  })
  .refine((b) => b.action !== "tone" || b.tone !== undefined, {
    message: "Cambiar tono requiere `tone`",
    path: ["tone"],
  });
export type WritingRequest = z.infer<typeof writingRequestSchema>;

/** Lo que el modelo debe devolver. */
export const writingResultSchema = z.object({
  text: z.string().trim().min(1),
});

const TONE_INSTRUCTION: Record<WritingTone, string> = {
  formal: "Reescríbelo con un tono formal y profesional (usted si el idioma lo permite).",
  casual: "Reescríbelo con un tono casual, cercano y amable, como un chat entre conocidos.",
  empatico:
    "Reescríbelo con un tono empático: reconoce la situación del cliente y muestra comprensión.",
};

function instruction(req: WritingRequest): string {
  switch (req.action) {
    case "improve":
      return "Mejora la redacción: corrige ortografía, puntuación y gramática, y hazlo claro y fluido sin cambiar el sentido.";
    case "tone":
      return TONE_INSTRUCTION[req.tone ?? "formal"];
    case "summarize":
      return "Resúmelo en lo esencial, en una o dos frases.";
    case "shorten":
      return "Hazlo más corto (aprox. la mitad) conservando la información importante.";
    case "lengthen":
      return "Hazlo un poco más largo y completo, desarrollando lo que ya dice, sin inventar datos nuevos.";
  }
}

export function buildWritingMessages(req: WritingRequest): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        WRITING_ASSIST_MARKER,
        "Eres un asistente de redacción para un asesor de ventas que escribe a un cliente por WhatsApp.",
        "Recibes un BORRADOR y una INSTRUCCIÓN. Devuelve solo el borrador transformado.",
        "Reglas:",
        "- Conserva el idioma del borrador.",
        "- No inventes precios, fechas, datos ni promesas que no estén en el borrador.",
        "- No agregues saludos, firmas ni comentarios sobre lo que hiciste.",
        "- Texto plano apto para WhatsApp (puedes usar *negritas* si ya venían).",
        'Responde ÚNICAMENTE un objeto JSON: {"text": "<borrador transformado>"}',
      ].join("\n"),
    },
    {
      role: "user",
      content: `ACCIÓN: ${req.action}${req.tone ? ` (${req.tone})` : ""}\nINSTRUCCIÓN: ${instruction(req)}\nBORRADOR:\n${req.text}`,
    },
  ];
}
