import { embedTexts, embeddingsConfig, type EmbedPurpose, type EmbedResult } from "@/lib/ai/embeddings";
import { logger } from "@/lib/log";
import { embedTokensUsed, recordEmbedUsage } from "@/server/ai-quota/quota";
import { getEmbedTokenLimit } from "@/server/limits";
import { checkEmbedAlerts } from "@/server/limits/alerts";

/**
 * 035 — La única forma de pedir embeddings desde el servidor: a nombre de UNA
 * organización, contando su uso (`ai_usage`, `kind = 'embed'`) y contra su
 * tope opcional (el propio de la organización, `organization_plan`, o
 * `AI_DEFAULT_MONTHLY_EMBED_TOKENS`). Equivale a
 * `chatJsonForOrg` para el modelo de chat.
 *
 *   const r = await embedForOrg(orgId, "passage", fragmentos);
 *
 * Guardarraíl: `tests/unit/embed-gate.test.ts` (nadie más importa
 * `embedTexts`). Un fallo al CONTAR nunca tumba el indexado ni el turno: se
 * registra y sigue. Fuera de transacción, como el LLM.
 */

const log = logger("ai");

export function embeddingsAvailable(): boolean {
  return embeddingsConfig() !== null;
}

/** El modelo con el que se embebe hoy (o `null` sin servicio). */
export function currentEmbeddingModel(): string | null {
  return embeddingsConfig()?.model ?? null;
}

export async function embedForOrg(
  organizationId: string,
  purpose: EmbedPurpose,
  texts: string[],
  opts: { timeoutMs?: number } = {}
): Promise<EmbedResult> {
  const config = embeddingsConfig();
  if (!config) return { ok: false, error: "not_configured", detail: "sin EMBEDDINGS_BASE_URL" };

  // 036 (PR 3a): el tope propio de la organización; sin él, el del entorno.
  let limit: number | null = null;
  try {
    limit = await getEmbedTokenLimit(organizationId);
  } catch (err) {
    log.error("no se pudo leer el tope de embeddings; la llamada sigue", { org: organizationId, err });
  }
  if (limit !== null) {
    try {
      if ((await embedTokensUsed(organizationId)) >= limit) {
        log.warn("tope mensual de embeddings alcanzado: no se llama al servicio", { org: organizationId });
        return { ok: false, error: "quota_exceeded", detail: "tope mensual de tokens de embeddings alcanzado" };
      }
    } catch (err) {
      log.error("no se pudo leer el uso de embeddings; la llamada sigue", { org: organizationId, err });
    }
  }

  const result = await embedTexts(texts, purpose, { timeoutMs: opts.timeoutMs, config });
  if (result.ok) {
    try {
      await recordEmbedUsage(organizationId, result.tokens);
    } catch (err) {
      log.error("no se pudo sumar el uso de embeddings", { org: organizationId, err });
    }
    await checkEmbedAlerts(organizationId);
  }
  return result;
}
