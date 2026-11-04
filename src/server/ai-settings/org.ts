import { and, eq } from "drizzle-orm";
import { withTenant, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { parseEffort } from "@/lib/ai/choice";
import { PLAN_SCOPES, type AiFunctionValues } from "./platform";

/**
 * 0070 — Lo PROPIO de una organización (en `ai_quota`): modelo y esfuerzo por
 * función y tope mensual de IA en dólares, más su plan guardado. Pool de la
 * app a nombre de la organización (RLS). Lo escribe solo el administrador de
 * plataforma (`PUT /api/platform/organizations/[id]/ai`).
 */

export type OrgAiOverrides = AiFunctionValues & { monthlyUsdLimit: number | null };
export type OrgAiState = { overrides: OrgAiOverrides; plan: (typeof PLAN_SCOPES)[number] | null };

const EMPTY: OrgAiOverrides = {
  agentModel: null,
  agentEffort: null,
  creatorModel: null,
  creatorEffort: null,
  assistantModel: null,
  monthlyUsdLimit: null,
};

export async function getOrgAiState(organizationId: string): Promise<OrgAiState> {
  return withTenant(organizationId, async (tx) => {
    const [q] = await tx.select().from(schema.aiQuota).where(scoped(schema.aiQuota.organizationId, organizationId)).limit(1);
    const [p] = await tx
      .select({ planKey: schema.organizationPlan.planKey })
      .from(schema.organizationPlan)
      .where(scoped(schema.organizationPlan.organizationId, organizationId))
      .limit(1);
    const plan = (PLAN_SCOPES as readonly string[]).includes(p?.planKey ?? "") ? (p!.planKey as OrgAiState["plan"]) : null;
    if (!q) return { overrides: { ...EMPTY }, plan };
    return {
      plan,
      overrides: {
        agentModel: q.agentModel?.trim() || null,
        agentEffort: parseEffort(q.agentEffort) ?? null,
        creatorModel: q.creatorModel?.trim() || null,
        creatorEffort: parseEffort(q.creatorEffort) ?? null,
        assistantModel: q.assistantModel?.trim() || null,
        monthlyUsdLimit: q.monthlyUsdLimit === null ? null : Number(q.monthlyUsdLimit),
      },
    };
  });
}

export async function saveOrgAiOverrides(organizationId: string, patch: Partial<OrgAiOverrides>): Promise<OrgAiOverrides> {
  await withTenant(organizationId, async (tx) => {
    const [q] = await tx.select().from(schema.aiQuota).where(scoped(schema.aiQuota.organizationId, organizationId)).limit(1);
    const keep = <K extends keyof OrgAiOverrides>(k: K, cur: string | null) =>
      patch[k] === undefined ? cur : patch[k] === null ? null : String(patch[k]);
    const values = {
      agentModel: keep("agentModel", q?.agentModel ?? null),
      agentEffort: keep("agentEffort", q?.agentEffort ?? null),
      creatorModel: keep("creatorModel", q?.creatorModel ?? null),
      creatorEffort: keep("creatorEffort", q?.creatorEffort ?? null),
      assistantModel: keep("assistantModel", q?.assistantModel ?? null),
      monthlyUsdLimit: keep("monthlyUsdLimit", q?.monthlyUsdLimit ?? null),
      updatedAt: new Date(),
    };
    await tx
      .insert(schema.aiQuota)
      .values({ organizationId, ...values })
      .onConflictDoUpdate({ target: schema.aiQuota.organizationId, set: values });
  });
  return (await getOrgAiState(organizationId)).overrides;
}

/** Gasto ESTIMADO de IA de la organización en un mes (`YYYY-MM`). */
export async function orgEstSpend(organizationId: string, period: string): Promise<number> {
  return withTenant(organizationId, async (tx) => {
    const [row] = await tx
      .select({ usd: schema.aiUsage.estCostUsd })
      .from(schema.aiUsage)
      .where(scoped(schema.aiUsage.organizationId, organizationId, and(eq(schema.aiUsage.period, period), eq(schema.aiUsage.kind, "total"))))
      .limit(1);
    return Number(row?.usd ?? 0);
  });
}
