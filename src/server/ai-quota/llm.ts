import type { z } from "zod";
import { chatJson, type ChatJsonResult, type ChatMessage } from "@/lib/ai";
import { isAiConfigured } from "@/lib/env";
import { logger } from "@/lib/log";
import { recordUsage, reserveTurn, type AiKind } from "@/server/ai-quota/quota";

/**
 * Fase 3, PR 1 — La única forma de llamar al modelo desde el servidor: a
 * nombre de UNA organización y contra su cuota mensual (`quota.ts`).
 *
 *   const r = await chatJsonForOrg(orgId, "agent", esquema, mensajes);
 *   if (!r.ok && r.error === "quota_exceeded") …
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
  opts?: { model?: string; judge?: boolean; timeoutMs?: number }
): Promise<ChatJsonResult<T>> {
  // Sin proveedor no hay turno que contar.
  if (!isAiConfigured()) return chatJson(schema, messages, opts);

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

  const result = await chatJson(schema, messages, opts);

  if (reservado && result.usage) {
    try {
      await recordUsage(organizationId, kind, result.usage);
    } catch (err) {
      log.error("no se pudieron sumar los tokens del turno de IA", { org: organizationId, tipo: kind, err });
    }
  }
  return result;
}
