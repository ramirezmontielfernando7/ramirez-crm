import { functionOfUse, layeredChoice, type AiChoice, type AiUse, type AssistantMode } from "@/lib/ai/choice";
import { getEnv } from "@/lib/env";
import { getOrgAiState } from "@/server/ai-settings/org";
import { getPlatformAiDefaults } from "@/server/ai-settings/platform";

/**
 * El modelo y el esfuerzo con que responde un uso de IA a nombre de una
 * organización, y su tope mensual en dólares. Prioridad: lo propio de la
 * empresa (`ai_quota`) > su plan > la instancia (Plataforma → IA) > las
 * variables de entorno. Solo lo llama la puerta (`chatJsonForOrg`).
 */
import type { FnCap, PoolMode } from "@/server/ai-quota/quota";
export type OrgAiResolution = AiChoice & { usdLimit: number | null; fnCap: FnCap; poolMode: PoolMode };

/** El tope mensual de IA en dólares: el propio de la empresa o el de su plan. */
export async function orgUsdLimit(organizationId: string): Promise<number | null> {
  const [state, defaults] = await Promise.all([getOrgAiState(organizationId), getPlatformAiDefaults()]);
  const plan = state.plan ? defaults[state.plan] : undefined;
  return state.overrides.monthlyUsdLimit ?? plan?.monthlyUsdLimit ?? null;
}

export async function resolveAiChoice(organizationId: string, use: AiUse, mode?: AssistantMode): Promise<OrgAiResolution> {
  const [state, defaults] = await Promise.all([getOrgAiState(organizationId), getPlatformAiDefaults()]);
  const plan = state.plan ? defaults[state.plan] : undefined;
  const layers = [state.overrides, plan ?? {}, defaults.instance ?? {}];
  const choice = layeredChoice(use, layers, getEnv(), mode);
  const o = state.overrides;
  const fn = functionOfUse(use);
  const fnCap: FnCap = { fn, usdLimit: o[`${fn}UsdLimit`], mode: o[`${fn}Mode`] };
  return { ...choice, usdLimit: o.monthlyUsdLimit ?? plan?.monthlyUsdLimit ?? null, fnCap, poolMode: o.poolMode };
}
