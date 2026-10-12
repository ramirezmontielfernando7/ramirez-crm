/**
 * 038 (PR 2) — Motor del asistente interno: las reglas PURAS (sin servidor,
 * BD ni React). Lo que aquí se decide:
 *
 * - Qué contesta el modelo en cada vuelta (`assistantStepSchema`): o pide
 *   consultas del CATÁLOGO cerrado (nunca SQL), o responde citando de qué
 *   consultas salieron sus datos.
 * - Los topes de cada pregunta (consultas y llamadas al modelo).
 * - El ENMASCARADO: antes de ir al proveedor de IA, los nombres de contactos y
 *   de personas del equipo, los teléfonos y los correos se cambian por fichas
 *   («[CONTACTO 1]», «[TELÉFONO 1]»…). El modelo sabe de quién se habla sin
 *   ver el dato real; al Propietario se le devuelve con los datos reales.
 * - La CUARENTENA: todo resultado de una consulta (y con él, cualquier texto
 *   escrito por clientes o por el equipo: mensajes, notas, nombres de
 *   etiquetas o etapas) viaja delimitado con un nonce por pregunta, como
 *   DATOS y nunca como instrucciones.
 */
import { z } from "zod";
import { sanitizeForPrompt } from "@/lib/kb-docs";

/** Consultas del catálogo que puede pedir UNA pregunta, en total. */
export const MAX_QUERIES_PER_QUESTION = 6;
/** Consultas que puede pedir en una sola vuelta. */
export const MAX_QUERIES_PER_STEP = 4;
/** Llamadas al modelo por pregunta (vueltas de consulta + la respuesta). */
export const MAX_MODEL_CALLS = 4;
/** Intercambios previos del hilo que se le recuerdan al modelo. */
export const HISTORY_EXCHANGES = 3;
/** Largo máximo de la pregunta. */
export const MAX_QUESTION_CHARS = 1000;
/** Lo más que se guarda de cada resultado para mostrarlo como fuente. */
export const MAX_SOURCE_RESULT_CHARS = 6000;
/** Días que se conservan las conversaciones del asistente (decisión del dueño). */
export const THREAD_RETENTION_DAYS = 90;

/** Marca del prompt del asistente (el mock del self-test la reconoce). */
export const ASSISTANT_MARKER = "ASISTENTE INTERNO DEL NEGOCIO (solo lectura)";

/** Lo que contesta el modelo en cada vuelta: JSON puro con UNA acción. */
export const assistantStepSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("query"),
    queries: z
      .array(
        z.object({
          name: z.string().min(1).max(80),
          args: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .min(1)
      .max(10),
  }),
  z.object({
    action: z.literal("answer"),
    text: z.string().trim().min(1).max(4000),
    sources: z.array(z.string().max(20)).max(20).optional(),
  }),
]);
export type AssistantStep = z.infer<typeof assistantStepSchema>;

/** Una consulta que corrió para contestar, tal como se le muestra al Propietario. */
export type AssistantSource = {
  /** «q1», «q2»…: con eso la cita el modelo. */
  id: string;
  name: string;
  label: string;
  args: Record<string, unknown>;
  /** ¿La citó el modelo en su respuesta? */
  cited: boolean;
  /** Lo que devolvió (con los datos reales), para verificar la respuesta. */
  result: unknown;
  truncated: boolean;
};

/**
 * Avisos de verificación de una respuesta:
 * - `no_sources`: dio cifras sin haber consultado nada.
 * - `invalid_citation`: citó una consulta que no corrió.
 * - `query_limit`: se llegó al tope de consultas de la pregunta.
 * - `rejected_query`: pidió una consulta que no existe o con parámetros inválidos.
 */
export type AssistantFlag = "no_sources" | "invalid_citation" | "query_limit" | "rejected_query";

export const ASSISTANT_FLAG_TEXT: Record<AssistantFlag, string> = {
  no_sources: "Ojo: esta respuesta trae cifras pero no se basó en ninguna consulta. Tómala con cuidado.",
  invalid_citation: "El asistente citó una consulta que no hizo; se muestran solo las que sí corrieron.",
  query_limit: `Se llegó al tope de ${MAX_QUERIES_PER_QUESTION} consultas por pregunta; la respuesta usa lo que alcanzó a revisar.`,
  rejected_query: "El asistente pidió una consulta que no existe o con datos inválidos; se ignoró.",
};

/** Lo que se guarda junto a cada respuesta (`assistant_message.sources`). */
export type AssistantMessageMeta = {
  sources: AssistantSource[];
  flags: AssistantFlag[];
  /** Consultas que corrieron y llamadas al modelo de esta pregunta. */
  queryCount: number;
  modelCalls: number;
};

/** Mensaje de un hilo tal como lo ve la pantalla. */
export type AssistantMessageDto = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  meta: AssistantMessageMeta | null;
};

export type AssistantThreadDto = { id: string; title: string; updatedAt: string };

// ---------------------------------------------------------------------------
// Enmascarado
// ---------------------------------------------------------------------------

export type MaskKind = "contact" | "member";

const KIND_LABEL: Record<MaskKind | "phone" | "email", string> = {
  contact: "CONTACTO",
  member: "PERSONA DEL EQUIPO",
  phone: "TELÉFONO",
  email: "CORREO",
};

/** Teléfonos: 8 o más dígitos, con espacios, guiones, puntos, paréntesis o «+». */
const PHONE_RE = /\+?\d(?:[\s().-]*\d){7,}/g;
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
const TOKEN_RE = /\[(CONTACTO|PERSONA DEL EQUIPO|TELÉFONO|CORREO) (\d+)\]/g;

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Cambia los datos personales por fichas y recuerda la equivalencia para
 * devolverle al Propietario los datos reales. Uno por pregunta (las fichas
 * son estables dentro de ella: «[CONTACTO 1]» es siempre la misma persona).
 */
export class Masker {
  private readonly real = new Map<string, string>(); // ficha → dato real
  private readonly byValue = new Map<string, string>(); // `kind:valor` → ficha
  private readonly counters: Record<string, number> = {};
  /** Partes de nombre (≥ 3 letras) → ficha, para encontrarlas en texto libre. */
  private readonly nameParts = new Map<string, string>();

  private token(kind: keyof typeof KIND_LABEL, value: string): string {
    const key = `${kind}:${fold(value)}`;
    const found = this.byValue.get(key);
    if (found) return found;
    const n = (this.counters[kind] = (this.counters[kind] ?? 0) + 1);
    const token = `[${KIND_LABEL[kind]} ${n}]`;
    this.byValue.set(key, token);
    this.real.set(token, value);
    return token;
  }

  /** La ficha de un nombre (contacto o persona del equipo). */
  name(kind: MaskKind, value: string | null | undefined): string | null {
    const v = (value ?? "").trim();
    if (!v) return null;
    const token = this.token(kind, v);
    for (const part of fold(v).split(/[^\p{L}\p{N}]+/u)) {
      if (part.length >= 3 && !this.nameParts.has(part)) this.nameParts.set(part, token);
    }
    return token;
  }

  /**
   * Texto libre (un mensaje, una nota, la pregunta): teléfonos y correos por
   * fichas, y cualquier nombre ya conocido (completo o por partes) también.
   * Quita los corchetes del original para que nadie pueda fabricar una ficha.
   */
  text(value: string | null | undefined): string {
    let t = (value ?? "").replace(/[[\]]/g, " ");
    t = t.replace(EMAIL_RE, (m) => this.token("email", m));
    t = t.replace(PHONE_RE, (m) => this.token("phone", m));
    if (this.nameParts.size === 0) return t;
    // Palabra por palabra, sin acentos ni mayúsculas, sin tocar las fichas ya puestas.
    return t
      .split(/(\[(?:CONTACTO|PERSONA DEL EQUIPO|TELÉFONO|CORREO) \d+\])/)
      .map((seg, i) => (i % 2 === 1 ? seg : seg.replace(/[\p{L}\p{N}]+/gu, (w) => this.nameParts.get(fold(w)) ?? w)))
      .join("");
  }

  /** De vuelta al Propietario: las fichas por los datos reales. */
  unmask(value: string): string {
    return value.replace(TOKEN_RE, (m) => this.real.get(m) ?? m);
  }

  /** ¿Cuántos datos se enmascararon? (para pruebas y registros). */
  get size(): number {
    return this.real.size;
  }
}

/** Una cadena que entra a un bloque de datos: sin controles ni delimitadores. */
export function quarantineString(value: string, maxChars = 500): string {
  const clean = sanitizeForPrompt(value).replace(/\s+/g, " ").trim();
  return clean.length > maxChars ? `${clean.slice(0, maxChars)}…` : clean;
}

/**
 * Un resultado de consulta como bloque de DATOS delimitado con el nonce de la
 * pregunta. Va en JSON (las cadenas no pueden partir líneas) y cada cadena ya
 * pasó por `quarantineString`, así que ninguna puede cerrar el bloque.
 */
export function renderDataBlock(id: string, name: string, data: unknown, nonce: string): string {
  return `<<DATOS ${id} · ${name} · ${nonce}>>\n${JSON.stringify(sanitizeDeep(data))}\n<<FIN DATOS ${id} · ${nonce}>>`;
}

function sanitizeDeep(value: unknown): unknown {
  if (typeof value === "string") return sanitizeForPrompt(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeDeep(v)]));
  }
  return value;
}

/** El resultado que se guarda como fuente: recortado si es muy largo. */
export function sourceResult(result: unknown): { result: unknown; truncated: boolean } {
  const json = JSON.stringify(result ?? null);
  if (json.length <= MAX_SOURCE_RESULT_CHARS) return { result, truncated: false };
  return { result: `${json.slice(0, MAX_SOURCE_RESULT_CHARS)}…`, truncated: true };
}

/** ¿La respuesta trae cifras? (para avisar si no consultó nada). */
export function hasFigures(text: string): boolean {
  return /\d/.test(text.replace(TOKEN_RE, ""));
}

/** El título del hilo: la primera pregunta, en una línea y corta. */
export function threadTitle(question: string): string {
  const t = question.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 79)}…` : t || "Conversación";
}
