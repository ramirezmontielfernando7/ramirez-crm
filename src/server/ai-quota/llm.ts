import type { z } from "zod";
import { chatJson, type ChatJsonResult, type ChatMessage } from "@/lib/ai";
import { isAiConfigured } from "@/lib/env";
import { logger } from "@/lib/log";
import { isAgentKind, recordAgentUsage, recordUsage, reserveTurn, type AiKind } from "@/server/ai-quota/quota";
import { checkAiAlerts } from "@/server/limits/alerts";

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
 * Guardarraíl: `tests/unit/ai-quota-gate.test.ts` (nadie más importa
 * `chatJson`). Un fallo al contar NUNCA tumba el turno: se registra y la
 * llamada sigue (la cuota protege la llave, no es un cobro).
 */

const log = logger("ai");

export async function chatJsonForOrg<T>(
  organizationId: string,
  kind: AiKind,
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  opts?: { model?: string; judge?: boolean; timeoutMs?: number; agentId?: string | null }
): Promise<ChatJsonResult<T>> {
  const { agentId, ...callOpts } = opts ?? {};
  // Sin proveedor no hay turno que contar.
  if (!isAiConfigured()) return chatJson(schema, messages, callOpts);

  let reservado = true;
  try {
    const r = await reserveTurn(organizationId, kind);
    if (!r.ok) {
      log.warn("cuota mensual de IA agotada: no se llama al modelo", { org: organizationId, tipo: kind, tope: r.limit });
      return {
        ok: false,
        error: "quota_exceeded",
        detail: r.limit === "turns" ? "tope mensual de turnos de IA alcanzado" : "tope mensual de tokens de IA alcanzado",
      };
    }
  } catch (err) {
    reservado = false;
    log.error("no se pudo reservar el turno de IA; la llamada sigue sin contarse", { org: organizationId, tipo: kind, err });
  }

  const result = await chatJson(schema, messages, callOpts);

  if (reservado && result.usage) {
    try {
      await recordUsage(organizationId, kind, result.usage);
    } catch (err) {
      log.error("no se pudieron sumar los tokens del turno de IA", { org: organizationId, tipo: kind, err });
    }
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
  return result;
}
