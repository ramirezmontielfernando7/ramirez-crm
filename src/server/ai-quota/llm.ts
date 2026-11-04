import type { z } from "zod";
import { cacheTtlOf, chatJson, type ChatJsonResult, type ChatMessage } from "@/lib/ai";
import { defaultUseOfKind, type AiEffort, type AiUse, type AssistantMode } from "@/lib/ai/choice";
import { getEnv, isAiConfigured } from "@/lib/env";
import { resolveAiChoice } from "@/server/ai-quota/choice";
import { priceOfModel } from "@/server/ai-settings/platform";
import { logger } from "@/lib/log";
import { CACHE_WRITE_FACTOR, CACHE_WRITE_FACTOR_1H, promptCachedCostUsd } from "@/lib/costs";
import {
  ASSISTANT_KIND,
  isAgentKind,
  recordAgentUsage,
  recordUsage,
  recordModelUsage,
  reserveTurn,
  type AiKind,
  type ReservationLimit,
} from "@/server/ai-quota/quota";
import { checkAiAlerts, checkAssistantAlerts } from "@/server/limits/alerts";

/**
 * Fase 3, PR 1 — La única forma de llamar al modelo desde el servidor: a
 * nombre de UNA organización y contra su cuota mensual (`quota.ts`).
 *
 *   const r = await chatJsonForOrg(orgId, "agent", esquema, mensajes);
 *   if (!r.ok && r.error === "quota_exceeded") …
 *
 * 036 (PR 1): `agentId` (opcional) anota el turno también al agente que lo
 * pidió (`ai_usage_agent`): el turno real, el Laboratorio, la vista previa y
 * el juez lo pasan; la escritura no tiene agente.
 *
 * 038 (PR 1): `assistant` (el asistente interno) choca primero con su propio
 * tope; sin tope asignado (o sin poder revisarlo) no se llama al modelo. El
 * `detail` lo dice.
 *
 * Guardarraíl: `tests/unit/ai-quota-gate.test.ts` (nadie más importa
 * `chatJson`). Un fallo al contar NUNCA tumba el turno: se registra y la
 * llamada no se realiza hasta poder reservar presupuesto.
 */

const log = logger("ai");

/** El motivo del rechazo, para registros y para quien llama. */
export const QUOTA_DETAIL: Record<ReservationLimit | "assistant_check_failed", string> = {
  turns: "tope mensual de turnos de IA alcanzado",
  usd: "tope mensual de IA (en dólares) alcanzado",
  tokens: "tope mensual de tokens de IA alcanzado",
  assistant_tokens: "tope mensual del asistente interno alcanzado",
  assistant_unset: "el asistente interno no tiene tope asignado",
  assistant_check_failed: "no se pudo revisar el tope del asistente interno",
};

export async function chatJsonForOrg<T>(
  organizationId: string,
  kind: AiKind,
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  opts?: {
    model?: string;
    effort?: AiEffort;
    timeoutMs?: number;
    agentId?: string | null;
    /** Qué función responde (por defecto, la que corresponde a `kind`). */
    use?: AiUse;
    /** Solo el asistente: Rápido / Normal / Profundo. */
    mode?: AssistantMode;
  }
): Promise<ChatJsonResult<T>> {
  const { agentId, use, mode, ...rest } = opts ?? {};
  // Sin proveedor no hay turno que contar.
  if (!isAiConfigured()) return chatJson(schema, messages, rest);

  // Modelo y esfuerzo de la función; un `model` explícito (pruebas, «Probar
  // conexión») manda sobre el elegido.
  let callOpts = rest;
  let usdLimit: number | null = null;
  try {
    const choice = await resolveAiChoice(organizationId, use ?? defaultUseOfKind(kind), mode);
    callOpts = { ...rest, model: rest.model ?? choice.model, effort: rest.effort ?? choice.effort };
    usdLimit = choice.usdLimit;
  } catch (err) {
    log.error("no se pudo resolver el modelo de la organización; se usa el de la instancia", { org: organizationId, tipo: kind, err });
  }

  const budget = reservationBudget(messages);
  const now = new Date();
  const reservado = true;
  try {
    const r = await reserveTurn(organizationId, kind, now, budget, usdLimit);
    if (!r.ok) {
      log.warn("cuota mensual de IA agotada: no se llama al modelo", { org: organizationId, tipo: kind, tope: r.limit });
      return { ok: false, error: "quota_exceeded", detail: QUOTA_DETAIL[r.limit] };
    }
  } catch (err) {
    log.error("no se pudo reservar presupuesto de IA; no se llama al modelo", { org: organizationId, tipo: kind, err });
    return { ok: false, error: "quota_exceeded", detail: "No se pudo verificar el presupuesto de IA. El chat humano sigue disponible." };
  }

  const result = await chatJson(schema, messages, callOpts);

  if (reservado) {
    try {
      const estUsd = await estimateCallUsd(result.model ?? callOpts.model, result.usage);
      await recordUsage(organizationId, kind, result.usage ?? { promptTokens: 0, completionTokens: 0 }, now, budget, estUsd);
    } catch (err) {
      log.error("no se pudieron sumar los tokens del turno de IA", { org: organizationId, tipo: kind, err });
    }
  }
  // 0070: qué modelo contestó, por función (antes solo el análisis).
  const usedModel = result.model ?? callOpts.model;
  // Caché de prompts: cuánto se leyó (barato) y se escribió (más caro) en la llamada.
  if (result.usage && (result.usage.cacheReadTokens || result.usage.cacheWriteTokens)) {
    log.info("caché de prompts", {
      org: organizationId,
      tipo: kind,
      modelo: usedModel,
      entrada: result.usage.promptTokens,
      leidos: result.usage.cacheReadTokens ?? 0,
      escritos: result.usage.cacheWriteTokens ?? 0,
    });
  }
  if (usedModel && result.usage) {
    try { await recordModelUsage(organizationId, kind, usedModel, result.usage, now); }
    catch (err) { log.error("no se pudo registrar el modelo de la llamada", { org: organizationId, tipo: kind, err }); }
  }
  // 036 — El desglose por agente: solo de turnos que se contaron, y nunca
  // tumba el turno (un agente que ya no existe, la BD caída…).
  if (reservado && agentId && isAgentKind(kind)) {
    try {
      await recordAgentUsage(organizationId, agentId, kind, result.usage ?? null);
    } catch (err) {
      log.error("no se pudo anotar el turno de IA a su agente", { org: organizationId, tipo: kind, agente: agentId, err });
    }
  }
  // 036 (PR 3a): avisos al 80 % y 100 % del tope (nunca tumba el turno).
  if (reservado) await checkAiAlerts(organizationId);
  if (reservado && (kind === ASSISTANT_KIND || kind === "analysis")) await checkAssistantAlerts(organizationId);
  return result;
}

/** Cota conservadora para tres intentos: UTF-8 + encuadre + salida máxima. */
export function reservationBudget(messages: ChatMessage[]): number {
  return 3 * (messages.reduce((n, m) => n + Buffer.byteLength(m.content, "utf8") + 64, 0) + 1024 + 8192);
}

/**
 * 0070 — Costo ESTIMADO de una llamada con el precio de su modelo (USD por
 * millón de tokens). Sin precio conocido: 0, y se avisa en el registro (el
 * tope en dólares no puede contar lo que no sabe cuánto cuesta).
 */
const sinPrecio = new Set<string>();
export async function estimateCallUsd(
  model: string | undefined,
  usage: { promptTokens: number; completionTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number } | undefined
): Promise<number> {
  if (!model || !usage) return 0;
  try {
    const p = await priceOfModel(model);
    if (!p) {
      if (!sinPrecio.has(model)) {
        sinPrecio.add(model);
        log.warn("modelo sin precio: su costo no cuenta en el tope en dólares", { modelo: model });
      }
      return 0;
    }
    return promptCachedCostUsd(usage, p.inputUsdPerMtok, p.outputUsdPerMtok, cacheTtlOf(getEnv().AI_CACHE_TTL) === "1h" ? CACHE_WRITE_FACTOR_1H : CACHE_WRITE_FACTOR);
  } catch (err) {
    log.error("no se pudo leer el precio del modelo", { modelo: model, err });
    return 0;
  }
}
