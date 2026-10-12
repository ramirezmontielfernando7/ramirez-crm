import { and, eq, isNull } from "drizzle-orm";
import { assistantMessage, nextResetDate, type AssistantState, type AssistantStatus } from "@/lib/assistant";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAiConfigured } from "@/lib/env";
import { projectGauge } from "@/lib/usage-visibility";
import { assistantTokensUsed, getUsageSummary } from "@/server/ai-quota/quota";
import { getAssistantTokenLimit, getUsageVisibility } from "@/server/limits";

/**
 * 038 (PR 1) — ¿Puede responder el asistente interno de esta organización, y
 * qué se le dice al Propietario? Solo lectura, a nombre de la organización
 * (pool de la app, RLS). La llamada al modelo (PR 2) pasa por
 * `chatJsonForOrg(org, "assistant", …)`, que vuelve a revisar los mismos
 * topes de forma atómica: esto es lo que la pantalla muestra antes.
 *
 * Orden: sin proveedor → sin tope propio → tope propio agotado → total de la
 * organización agotado → disponible. Nunca dólares ni tokens (salvo que la
 * visibilidad sea `tokens`).
 */
export async function getAssistantStatus(
  organizationId: string,
  userId: string,
  now = new Date()
): Promise<AssistantStatus> {
  const resetsOn = nextResetDate(now);
  const visibility = await getUsageVisibility(organizationId);
  const limit = await getAssistantTokenLimit(organizationId);
  const used = await assistantTokensUsed(organizationId, now);
  const gauge = limit === null ? null : projectGauge(visibility, used, limit);

  let state: AssistantState;
  if (!isAiConfigured()) state = "not_configured";
  else if (limit === null) state = "unset";
  else if (used >= limit) state = "exhausted";
  else if (await totalExhausted(organizationId, now)) state = "ai_exhausted";
  else state = "available";

  return {
    state,
    canAsk: state === "available",
    message: assistantMessage(state, resetsOn),
    gauge,
    resetsOn,
    noticeAcceptedAt: await noticeAcceptedAt(organizationId, userId),
  };
}

/** ¿La IA de la organización (turnos o tokens del total) ya llegó a su tope? */
async function totalExhausted(organizationId: string, now: Date): Promise<boolean> {
  const s = await getUsageSummary(organizationId, now);
  return (s.limits.turns !== null && s.turns >= s.limits.turns) || (s.limits.tokens !== null && s.tokens >= s.limits.tokens);
}

async function noticeAcceptedAt(organizationId: string, userId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ at: schema.userPreference.assistantNoticeAcceptedAt })
    .from(schema.userPreference)
    .where(scoped(schema.userPreference.organizationId, organizationId, eq(schema.userPreference.userId, userId)))
    .limit(1);
  return row?.at?.toISOString() ?? null;
}

/**
 * La persona aceptó el aviso de consumo (se pide una vez, antes del primer
 * uso). Idempotente: la primera aceptación se conserva.
 */
export async function acceptAssistantNotice(organizationId: string, userId: string, now = new Date()): Promise<string> {
  const db = getDb();
  await db
    .insert(schema.userPreference)
    .values({ organizationId, userId, assistantNoticeAcceptedAt: now, updatedAt: now })
    .onConflictDoNothing();
  await db
    .update(schema.userPreference)
    .set({ assistantNoticeAcceptedAt: now, updatedAt: now })
    .where(
      scoped(
        schema.userPreference.organizationId,
        organizationId,
        and(eq(schema.userPreference.userId, userId), isNull(schema.userPreference.assistantNoticeAcceptedAt))
      )
    );
  return (await noticeAcceptedAt(organizationId, userId)) ?? now.toISOString();
}
