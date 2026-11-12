import { functionOfUse, layeredChoice, type AiChoice, type AiUse, type AssistantMode } from "@/lib/ai/choice";
import { capUsd } from "@/lib/fn-caps";
import { getEnv } from "@/lib/env";
import { getOrgAiState } from "@/server/ai-settings/org";
import { getPlatformAiDefaults } from "@/server/ai-settings/platform";
import { getAiBonusUsd } from "@/server/billing/store";

/**
 * El modelo y el esfuerzo con que responde un uso de IA a nombre de una
 * organización, y su tope mensual en dólares. Prioridad: lo propio de la
 * empresa (`ai_quota`) > su plan > la instancia (Plataforma → IA) > las
 * variables de entorno. Solo lo llama la puerta (`chatJsonForOrg`).
 */
import type { FnCap, PoolMode } from "@/server/ai-quota/quota";
export type OrgAiResolution = AiChoice & { usdLimit: number | null; fnCap: FnCap; poolMode: PoolMode };

/** 048 — El tope mensual de la bolsa SIN la IA extra del mes (lo que cuesta «restablecer»). */
export async function orgBaseUsdLimit(organizationId: string): Promise<number | null> {
  const [state, defaults] = await Promise.all([getOrgAiState(organizationId), getPlatformAiDefaults()]);
  const plan = state.plan ? defaults[state.plan] : undefined;
  return state.overrides.monthlyUsdLimit ?? plan?.monthlyUsdLimit ?? null;
}

/**
 * El tope mensual de IA en dólares: el propio de la empresa o el de su plan,
 * más la IA extra de ESTE mes que se vendió (048, «restablecer la IA»).
 */
export async function orgUsdLimit(organizationId: string): Promise<number | null> {
  const [base, bonus] = await Promise.all([orgBaseUsdLimit(organizationId), getAiBonusUsd(organizationId)]);
  return base === null ? null : base + bonus;
}

export async function resolveAiChoice(organizationId: string, use: AiUse, mode?: AssistantMode): Promise<OrgAiResolution> {
  const [state, defaults, bonus] = await Promise.all([getOrgAiState(organizationId), getPlatformAiDefaults(), getAiBonusUsd(organizationId)]);
  const plan = state.plan ? defaults[state.plan] : undefined;
  const layers = [state.overrides, plan ?? {}, defaults.instance ?? {}];
  const choice = layeredChoice(use, layers, getEnv(), mode);
  const o = state.overrides;
  const fn = functionOfUse(use);
  const base = o.monthlyUsdLimit ?? plan?.monthlyUsdLimit ?? null;
  // 048: la IA extra del mes amplía la bolsa (y un tope por función escrito en % la sigue).
  const pool = base === null ? null : base + bonus;
  const fnCap: FnCap = { fn, usdLimit: capUsd(o.caps[fn], pool), mode: o[`${fn}Mode`] };
  return { ...choice, usdLimit: pool, fnCap, poolMode: o.poolMode };
}
