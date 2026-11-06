import { computePace, nextPlan, promptKind, type PaceInfo, type PromptKind } from "@/lib/upgrade-prompts";
import type { PlanKey } from "@/lib/limits";
import type { CatalogScope } from "@/lib/plan-catalog";
import { orgUsdLimit } from "@/server/ai-quota/choice";
import { currentPeriod } from "@/server/ai-quota/quota";
import { orgEstSpend } from "@/server/ai-settings/org";
import { getEffectiveLimits } from "@/server/limits";

/**
 * Lo que necesita la ventana «Vas muy rápido con la IA» / «Llegaste al
 * límite»: el ritmo de gasto del mes contra el tope en dólares, SIN dólares
 * en el resultado (solo porcentajes y fechas). Con la visibilidad «status»
 * (`organization_plan.usage_visibility`) no viaja ninguna cifra: solo avisa
 * cuando ya se agotó. Pool de la app, a nombre de la organización (RLS).
 */
export type PaceResult = {
  kind: PromptKind | null;
  plan: PlanKey;
  nextPlan: CatalogScope | null;
  /** `null` con visibilidad «status» o sin tope. */
  pace: Pick<PaceInfo, "percent" | "projectedPercent" | "hitDate" | "resetDate" | "daysLeft" | "exhausted"> | null;
};

export async function getAiPace(organizationId: string, now = new Date()): Promise<PaceResult> {
  const limits = await getEffectiveLimits(organizationId);
  const base = { plan: limits.planKey, nextPlan: nextPlan(limits.planKey) };
  const usd = await orgUsdLimit(organizationId);
  if (usd === null || usd <= 0) return { ...base, kind: null, pace: null };
  const spent = await orgEstSpend(organizationId, currentPeriod(now));
  const info = computePace(spent, usd, now);
  const kind = promptKind(info);
  if (limits.usageVisibility === "status") {
    // Sin cifras: solo se avisa cuando ya se agotó.
    return { ...base, kind: info.exhausted ? "limit" : null, pace: null };
  }
  return {
    ...base,
    kind,
    pace: {
      percent: Math.round(info.percent),
      projectedPercent: Math.round(info.projectedPercent),
      hitDate: info.hitDate,
      resetDate: info.resetDate,
      daysLeft: info.daysLeft,
      exhausted: info.exhausted,
    },
  };
}
