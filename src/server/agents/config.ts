import { z } from "zod";
import type { schema } from "@/lib/db";

/**
 * 031 — La forma ÚNICA de la configuración de un agente (`agent.draft` y
 * `agent.published`). Nadie lee ni escribe ese JSON sin pasar por aquí.
 *
 * Límites iguales a los del `putSchema` histórico de `/api/agent/profile`.
 * Un texto vacío se guarda como `null` (no configurado); un nombre de
 * presentación `null` = el agente no se presenta con un nombre propio.
 */

type AgentProfile = typeof schema.agentProfile.$inferSelect;

/** El nombre que el espejo escribe en `agent_profile` cuando no hay nombre. */
export const MIRROR_DEFAULT_NAME = "Asistente";

/** Texto opcional: ausente o vacío = `null` (no configurado). */
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v),
    z.string().max(max).nullable()
  );

/** Para ESCRIBIR (lo que llega de una persona). */
export const agentConfigSchema = z.object({
  v: z.literal(1).default(1),
  displayName: z.preprocess(
    (v) => (v === undefined ? null : typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v),
    z.string().max(60).nullable()
  ),
  tone: optionalText(500),
  greeting: optionalText(1000),
  instructions: optionalText(8000),
  escalationRules: optionalText(4000),
  useSharedKb: z.boolean().default(true),
});

export type AgentConfig = {
  v: 1;
  displayName: string | null;
  tone: string | null;
  greeting: string | null;
  instructions: string | null;
  escalationRules: string | null;
  useSharedKb: boolean;
};

/**
 * Para LEER lo guardado: tolerante (sin topes de longitud), porque el
 * backfill copia el perfil tal cual y un turno nunca debe morir por un
 * texto que ya estaba en producción.
 */
const storedConfigSchema = z.object({
  v: z.literal(1).catch(1),
  displayName: z.string().nullable().catch(null),
  tone: z.string().nullable().catch(null),
  greeting: z.string().nullable().catch(null),
  instructions: z.string().nullable().catch(null),
  escalationRules: z.string().nullable().catch(null),
  useSharedKb: z.boolean().catch(true),
});

export function parseStoredConfig(raw: unknown): AgentConfig | null {
  if (raw === null || raw === undefined) return null;
  const parsed = storedConfigSchema.safeParse(raw);
  return parsed.success ? (parsed.data as AgentConfig) : null;
}

export function emptyConfig(): AgentConfig {
  return {
    v: 1,
    displayName: null,
    tone: null,
    greeting: null,
    instructions: null,
    escalationRules: null,
    useSharedKb: true,
  };
}

/** Lo que recibe el prompt del agente (y el texto del juez). */
export type AgentPromptConfig = {
  name: string | null;
  tone: string | null;
  instructions: string | null;
  escalationRules: string | null;
  greeting: string | null;
};

export function toPromptConfig(c: AgentConfig): AgentPromptConfig {
  return {
    name: c.displayName,
    tone: c.tone,
    instructions: c.instructions,
    escalationRules: c.escalationRules,
    greeting: c.greeting,
  };
}

/** Adaptador para quien todavía tiene la fila de `agent_profile`. */
export function profileToPromptConfig(p: AgentProfile): AgentPromptConfig {
  return {
    name: p.name,
    tone: p.tone,
    instructions: p.instructions,
    escalationRules: p.escalationRules,
    greeting: p.greeting,
  };
}

/** La config que equivale a un `agent_profile` (backfill y reconciliación). */
export function configFromProfile(p: Pick<AgentProfile, "name" | "tone" | "instructions" | "escalationRules" | "greeting">): AgentConfig {
  return {
    v: 1,
    displayName: p.name,
    tone: p.tone,
    greeting: p.greeting,
    instructions: p.instructions,
    escalationRules: p.escalationRules,
    useSharedKb: true,
  };
}

/** Lo que el espejo escribe en `agent_profile` para una config publicada. */
export function mirrorFields(c: AgentConfig) {
  return {
    name: c.displayName ?? MIRROR_DEFAULT_NAME,
    tone: c.tone,
    instructions: c.instructions,
    escalationRules: c.escalationRules,
    greeting: c.greeting,
  };
}

export function sameConfig(a: AgentConfig, b: AgentConfig): boolean {
  return (
    a.displayName === b.displayName &&
    a.tone === b.tone &&
    a.greeting === b.greeting &&
    a.instructions === b.instructions &&
    a.escalationRules === b.escalationRules &&
    a.useSharedKb === b.useSharedKb
  );
}

/** Texto del comportamiento para el juez del Laboratorio. */
export function behaviorText(c: AgentPromptConfig): string {
  return [
    `Nombre: ${c.name ?? "(sin nombre propio)"}`,
    c.tone ? `Tono: ${c.tone}` : null,
    c.instructions ? `Instrucciones: ${c.instructions}` : null,
    c.escalationRules ? `Escalado: ${c.escalationRules}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
