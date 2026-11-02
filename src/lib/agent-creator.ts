import { z } from "zod";

/**
 * Creador conversacional del agente (Estudio de IA) — reglas PURAS, sin
 * servidor: qué campos puede tocar el creador, sus topes de longitud (los
 * mismos de `agentConfigSchema`), cómo se limpian las propuestas del modelo y
 * cómo se muestra una diferencia palabra por palabra.
 */

export const CREATOR_FIELDS = ["displayName", "tone", "greeting", "instructions", "escalationRules"] as const;
export type CreatorField = (typeof CREATOR_FIELDS)[number];

export const CREATOR_FIELD_LABEL: Record<CreatorField, string> = {
  displayName: "Nombre de presentación",
  tone: "Tono",
  greeting: "Saludo",
  instructions: "Instrucciones",
  escalationRules: "Reglas de escalado",
};

/** Mismos topes que `agentConfigSchema` (src/server/agents/config.ts). */
export const CREATOR_FIELD_MAX: Record<CreatorField, number> = {
  displayName: 60,
  tone: 500,
  greeting: 1000,
  instructions: 8000,
  escalationRules: 4000,
};

export const MAX_CREATOR_UPDATES = 5;
export const MAX_QUICK_REPLIES = 4;

export const fieldEnum = z.enum(CREATOR_FIELDS);

/** Lo que el modelo devuelve en un turno del creador (tolerante: se limpia después). */
export const creatorOutputSchema = z.object({
  reply: z.string(),
  updates: z.array(z.object({ field: z.string(), value: z.string() })).optional(),
  quickReplies: z.array(z.string()).optional(),
});

/** Lo que el modelo devuelve al revisar un chat de prueba. */
export const reviewOutputSchema = z.object({
  summary: z.string().optional(),
  suggestions: z
    .array(z.object({ field: z.string(), title: z.string(), reason: z.string().optional(), value: z.string() }))
    .optional(),
});

export type FieldUpdate = { field: CreatorField; value: string };

/**
 * Deja solo cambios válidos: campo conocido, texto no vacío y dentro del tope
 * (un texto que se pasa se descarta entero, nunca se corta a la mitad), uno
 * por campo (gana el último), sin los que no cambian nada y con tope por turno.
 */
export function sanitizeUpdates(raw: { field: string; value: string }[], current: Record<CreatorField, string | null>): FieldUpdate[] {
  const byField = new Map<CreatorField, string>();
  for (const u of raw) {
    const parsed = fieldEnum.safeParse(u.field);
    if (!parsed.success) continue;
    const value = u.value.trim();
    if (!value || value.length > CREATOR_FIELD_MAX[parsed.data]) continue;
    byField.set(parsed.data, value);
  }
  return [...byField.entries()]
    .filter(([field, value]) => (current[field] ?? "").trim() !== value)
    .slice(0, MAX_CREATOR_UPDATES)
    .map(([field, value]) => ({ field, value }));
}

export function sanitizeQuickReplies(raw: string[]): string[] {
  return raw
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 80)
    .slice(0, MAX_QUICK_REPLIES);
}

export type DiffPart = { kind: "same" | "del" | "ins"; text: string };

/**
 * Diferencia sencilla: lo que se repite al principio y al final queda igual,
 * y lo del medio se muestra como «quitado» y «agregado». Basta para que se
 * vea qué cambia en un texto corto sin una librería de diferencias.
 */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.trim().split(/\s+/).filter(Boolean);
  const b = after.trim().split(/\s+/).filter(Boolean);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], words: string[]) => {
    if (words.length) parts.push({ kind, text: words.join(" ") });
  };
  push("same", a.slice(0, start));
  push("del", a.slice(start, endA));
  push("ins", b.slice(start, endB));
  push("same", a.slice(endA));
  return parts;
}
