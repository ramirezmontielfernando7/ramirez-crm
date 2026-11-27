import { and, eq } from "drizzle-orm";
import { withTenant, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { parseEffort } from "@/lib/ai/choice";
import type { FnCapValue } from "@/lib/fn-caps";
import { CAP_UNITS, type CapUnit } from "@/lib/fn-caps";
import { PLAN_SCOPES, type AiFunctionValues } from "./platform";

/**
 * 0070 — Lo PROPIO de una organización (en `ai_quota`): modelo y esfuerzo por
 * función y tope mensual de IA en dólares, más su plan guardado. Pool de la
 * app a nombre de la organización (RLS). Lo escribe solo el administrador de
 * plataforma (`PUT /api/platform/organizations/[id]/ai`).
 */

type OverMode = "block" | "warn";
const asMode = (v: string | null | undefined): OverMode => (v === "warn" ? "warn" : "block");
const asUnit = (v: string | null | undefined): CapUnit => ((CAP_UNITS as readonly string[]).includes(v ?? "") ? (v as CapUnit) : "usd");
const capOf = (unit: string | null, value: string | null, usd: string | null): FnCapValue => ({ unit: asUnit(unit), value: asNum(value), usd: asNum(usd) });
const asNum = (v: string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

/** 0071 — Topes de seguridad por función en dólares (NULL = usa la bolsa) y qué hacer al llenarse. */
export type OrgAiCaps = {
  /** 0072 — Cada tope como se escribió (unidad, valor y dólares ya convertidos). */
  caps: { agent: FnCapValue; creator: FnCapValue; assistant: FnCapValue };
  poolMode: OverMode;
  agentMode: OverMode;
  creatorMode: OverMode;
  assistantMode: OverMode;
};
export type OrgAiOverrides = AiFunctionValues & { monthlyUsdLimit: number | null } & OrgAiCaps;
/** Lo que se puede cambiar: `caps` por función (las que no vengan se conservan). */
export type OrgAiPatch = Partial<Omit<OrgAiOverrides, "caps">> & { caps?: Partial<OrgAiCaps["caps"]> };
type OrgAiState = { overrides: OrgAiOverrides; plan: (typeof PLAN_SCOPES)[number] | null };

const EMPTY: OrgAiOverrides = {
  agentModel: null,
  agentEffort: null,
  creatorModel: null,
  creatorEffort: null,
  assistantModel: null,
  monthlyUsdLimit: null,
  caps: {
    agent: { unit: "pct", value: null, usd: null },
    creator: { unit: "pct", value: null, usd: null },
    assistant: { unit: "pct", value: null, usd: null },
  },
  poolMode: "block",
  agentMode: "block",
  creatorMode: "block",
  assistantMode: "block",
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
        caps: {
          agent: capOf(q.agentCapUnit, q.agentCapValue, q.agentUsdLimit),
          creator: capOf(q.creatorCapUnit, q.creatorCapValue, q.creatorUsdLimit),
          assistant: capOf(q.assistantCapUnit, q.assistantCapValue, q.assistantUsdLimit),
        },
        poolMode: asMode(q.poolMode),
        agentMode: asMode(q.agentMode),
        creatorMode: asMode(q.creatorMode),
        assistantMode: asMode(q.assistantMode),
      },
    };
  });
}

/** Las columnas de un tope por función: `pct` guarda solo el valor (los dólares los resuelve el total). */
function capColumns(fn: "agent" | "creator" | "assistant", cap: FnCapValue | undefined, q: typeof schema.aiQuota.$inferSelect | undefined) {
  const unit = `${fn}CapUnit` as const;
  const value = `${fn}CapValue` as const;
  const usd = `${fn}UsdLimit` as const;
  if (!cap) return { [unit]: q?.[unit] ?? "usd", [value]: q?.[value] ?? null, [usd]: q?.[usd] ?? null };
  if (cap.value === null) return { [unit]: cap.unit, [value]: null, [usd]: null };
  return { [unit]: cap.unit, [value]: String(cap.value), [usd]: cap.unit === "pct" || cap.usd === null ? null : String(cap.usd) };
}

export async function saveOrgAiOverrides(organizationId: string, patch: OrgAiPatch): Promise<OrgAiOverrides> {
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
      ...capColumns("agent", patch.caps?.agent, q),
      ...capColumns("creator", patch.caps?.creator, q),
      ...capColumns("assistant", patch.caps?.assistant, q),
      poolMode: asMode(patch.poolMode ?? q?.poolMode),
      agentMode: asMode(patch.agentMode ?? q?.agentMode),
      creatorMode: asMode(patch.creatorMode ?? q?.creatorMode),
      assistantMode: asMode(patch.assistantMode ?? q?.assistantMode),
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
