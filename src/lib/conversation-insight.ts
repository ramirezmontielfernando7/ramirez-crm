/**
 * 038 (PR 3) — Análisis guardado por conversación (`conversation_insight`):
 * las reglas PURAS (sin servidor, BD ni React).
 *
 * - Categorías CERRADAS: el modelo elige de listas fijas (o «no se sabe»);
 *   lo que no reconozca se guarda como «no se sabe», nunca texto libre.
 * - Antes de gastar tokens, una conversación sin información suficiente
 *   (vacía, muy corta, solo multimedia, solo mensajes automáticos o sin
 *   mensajes del cliente) se marca como tal y NO va al modelo.
 * - El transcript que ve el modelo va enmascarado (`Masker`) y en cuarentena.
 * - Topes: cuántas conversaciones NUEVAS se analizan por pregunta y de a
 *   cuántas por llamada al modelo.
 */
import { z } from "zod";
import { quarantineString, type Masker } from "@/lib/assistant-engine";

/**
 * Conversaciones que se analizan (nuevas o con mensajes nuevos) en UNA
 * pregunta, en total. Las ya analizadas sin cambios no cuentan: se reutilizan.
 */
export const INSIGHT_MAX_NEW_PER_QUESTION = 20;
/** Conversaciones por llamada al modelo. */
export const INSIGHT_BATCH_SIZE = 5;
/** De cada conversación, los últimos N mensajes… */
export const INSIGHT_MAX_MESSAGES = 40;
/** …y como mucho estos caracteres de texto (lo más reciente manda). */
export const INSIGHT_MAX_CHARS = 3000;
/** Periodo por defecto y máximo de una pregunta, en días. */
export const INSIGHT_DEFAULT_DAYS = 30;
export const INSIGHT_MAX_DAYS = 90;

/** Marca del prompt del análisis (el mock del self-test la reconoce). */
export const ANALYSIS_MARKER = "ANÁLISIS DE CONVERSACIONES DEL NEGOCIO";

export const OUTCOMES = ["venta", "perdida", "en_curso", "sin_respuesta", "no_se_sabe"] as const;
export const LOSS_REASONS = [
  "precio",
  "no_interesado",
  "eligio_competencia",
  "sin_respuesta",
  "fuera_de_zona",
  "sin_disponibilidad",
  "otro",
  "no_aplica",
  "no_se_sabe",
] as const;
export const OBJECTIONS = ["precio", "tiempo_entrega", "confianza", "forma_pago", "caracteristicas", "ninguna", "otro", "no_se_sabe"] as const;
export const ADVISOR_PERFORMANCE = ["bueno", "regular", "malo", "sin_asesor", "no_se_sabe"] as const;
export const CONFIDENCE = ["alta", "media", "baja"] as const;
export const INSUFFICIENT_REASONS = ["vacia", "muy_corta", "solo_multimedia", "solo_automaticos", "sin_mensajes_del_cliente"] as const;

export type Outcome = (typeof OUTCOMES)[number];
export type LossReason = (typeof LOSS_REASONS)[number];
export type Objection = (typeof OBJECTIONS)[number];
export type AdvisorPerformance = (typeof ADVISOR_PERFORMANCE)[number];
export type Confidence = (typeof CONFIDENCE)[number];
export type InsufficientReason = (typeof INSUFFICIENT_REASONS)[number];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  venta: "Venta",
  perdida: "Perdida",
  en_curso: "En curso",
  sin_respuesta: "El cliente dejó de responder",
  no_se_sabe: "No se sabe",
};
export const LOSS_REASON_LABEL: Record<LossReason, string> = {
  precio: "Precio",
  no_interesado: "No le interesó",
  eligio_competencia: "Eligió a la competencia",
  sin_respuesta: "Dejó de responder",
  fuera_de_zona: "Fuera de zona o cobertura",
  sin_disponibilidad: "Sin disponibilidad o existencias",
  otro: "Otro",
  no_aplica: "No aplica",
  no_se_sabe: "No se sabe",
};
export const OBJECTION_LABEL: Record<Objection, string> = {
  precio: "Precio",
  tiempo_entrega: "Tiempo de entrega",
  confianza: "Confianza",
  forma_pago: "Forma de pago",
  caracteristicas: "Características del producto",
  ninguna: "Ninguna",
  otro: "Otra",
  no_se_sabe: "No se sabe",
};
export const ADVISOR_PERFORMANCE_LABEL: Record<AdvisorPerformance, string> = {
  bueno: "Bueno",
  regular: "Regular",
  malo: "Malo",
  sin_asesor: "Sin asesor (solo IA o automáticos)",
  no_se_sabe: "No se sabe",
};
export const INSUFFICIENT_LABEL: Record<InsufficientReason, string> = {
  vacia: "Sin mensajes",
  muy_corta: "Muy corta",
  solo_multimedia: "Solo audios, imágenes u otros archivos",
  solo_automaticos: "Solo mensajes automáticos",
  sin_mensajes_del_cliente: "El cliente no escribió",
};

/** Lo que devuelve el modelo por conversación. Lo desconocido → «no se sabe» (nunca rompe el lote). */
const oneOf = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.enum(values))
    .catch(fallback);

export const insightItemSchema = z.object({
  id: z.string().min(1).max(10),
  resultado: oneOf(OUTCOMES, "no_se_sabe"),
  motivo_perdida: oneOf(LOSS_REASONS, "no_se_sabe"),
  objecion: oneOf(OBJECTIONS, "no_se_sabe"),
  desempeno_asesor: oneOf(ADVISOR_PERFORMANCE, "no_se_sabe"),
  confianza: oneOf(CONFIDENCE, "baja"),
  resumen: z
    .string()
    .catch("")
    .transform((s) => s.replace(/\s+/g, " ").trim().slice(0, 300)),
});
export const insightBatchSchema = z.object({ analisis: z.array(insightItemSchema).max(INSIGHT_BATCH_SIZE * 2) });
export type InsightItem = z.infer<typeof insightItemSchema>;
export type InsightBatch = z.infer<typeof insightBatchSchema>;

/** Un mensaje como lo necesita el análisis. */
export type InsightMessage = {
  direction: "in" | "out";
  type: string;
  text: string | null;
  origin: "ai" | "operator" | "manual" | "template";
  aiGenerated: boolean;
};

const isText = (m: InsightMessage) => m.type === "text" && !!m.text?.trim();
const isAutomated = (m: InsightMessage) => m.direction === "out" && (m.aiGenerated || m.origin === "ai" || m.origin === "template");

/**
 * ¿Hay algo que analizar? Reglas sin modelo, para no gastar tokens en una
 * base desordenada. `null` = sí, hay información suficiente.
 */
export function insufficientReason(messages: InsightMessage[]): InsufficientReason | null {
  if (messages.length === 0) return "vacia";
  const inboundText = messages.filter((m) => m.direction === "in" && isText(m));
  if (inboundText.length === 0) {
    if (messages.some((m) => m.direction === "in")) return "solo_multimedia";
    if (messages.every(isAutomated)) return "solo_automaticos";
    return "sin_mensajes_del_cliente";
  }
  const chars = messages.filter(isText).reduce((n, m) => n + (m.text ?? "").trim().length, 0);
  const inboundChars = inboundText.reduce((n, m) => n + (m.text ?? "").trim().length, 0);
  if (inboundChars < 12 || chars < 40) return "muy_corta";
  return null;
}

function speaker(m: InsightMessage): string {
  if (m.direction === "in") return "cliente";
  if (m.origin === "template") return "negocio (plantilla)";
  if (m.aiGenerated || m.origin === "ai") return "negocio (IA)";
  return "negocio (persona)";
}

/**
 * El transcript que ve el modelo: los últimos mensajes (lo más reciente
 * manda si hay que recortar), una línea por mensaje, enmascarado y sin
 * delimitadores (`quarantineString`), multimedia como «(imagen)», etc.
 */
export function renderTranscript(messages: InsightMessage[], masker: Masker): string {
  const lines: string[] = [];
  let chars = 0;
  for (const m of [...messages].slice(-INSIGHT_MAX_MESSAGES).reverse()) {
    const body = isText(m) ? quarantineString(masker.text(m.text), 600) : `(${m.type === "text" ? "mensaje vacío" : m.type})`;
    const line = `${speaker(m)}: ${body}`;
    if (chars + line.length > INSIGHT_MAX_CHARS && lines.length > 0) break;
    chars += line.length;
    lines.push(line);
  }
  return lines.reverse().join("\n");
}

/** Cuántas veces aparece cada valor, de más a menos (sin ceros). */
export function tally<T extends string>(values: T[], labels: Record<T, string>): { valor: string; conversaciones: number }[] {
  const n = new Map<T, number>();
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => ({ valor: labels[v] ?? v, conversaciones: c }));
}
