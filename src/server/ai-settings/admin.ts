import { eq } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import {
  AI_FUNCTIONS,
  envFunctionEffort,
  envFunctionModel,
  type AiEffort,
  type AiFunction,
} from "@/lib/ai/choice";
import { MODEL_CATALOG, modelLabel } from "@/lib/costs";
import { getEnv } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { currentPeriod } from "@/server/ai-quota/quota";
import { recordPlatformAudit, type AuditActor } from "@/server/platform-admin/audit";
import { PlatformError } from "@/server/platform-admin/organizations";
import { getOrgAiState, orgEstSpend, saveOrgAiOverrides, type OrgAiOverrides } from "./org";
import {
  AI_DEFAULT_SCOPES,
  getModelPriceRows,
  getPlatformAiDefaults,
  platformEstSpendSince,
  priceOfModel,
  saveModelPrice,
  savePlatformAiDefaults,
  type AiDefaultScope,
  type AiDefaultsPatch,
  type AiDefaultsRow,
  type AiFunctionValues,
  type ModelPrice,
} from "./platform";

/**
 * 0070 — Lo que ve y cambia el administrador de plataforma en «Modelos de
 * IA»: la instancia, cada plan, cada empresa, los precios por modelo y el
 * presupuesto contra los créditos. Cada cambio queda en la bitácora.
 */

export type Origin = "empresa" | "plan" | "instancia" | "entorno";
export type FunctionView = { model: string | null; modelLabel: string; effort: AiEffort | null; origin: Origin; effortOrigin: Origin };

const MODEL_KEY: Record<AiFunction, keyof AiFunctionValues> = { agent: "agentModel", creator: "creatorModel", assistant: "assistantModel" };
const EFFORT_KEY: Record<AiFunction, keyof AiFunctionValues | null> = { agent: "agentEffort", creator: "creatorEffort", assistant: null };

type Layer = { origin: Origin; values: Partial<AiFunctionValues> };

/** El modelo y esfuerzo que aplica a una función y de qué capa viene (pura). */
export function effectiveFunction(fn: AiFunction, layers: Layer[]): FunctionView {
  const env = getEnv();
  const pick = <T>(key: keyof AiFunctionValues | null, fallback: T): { v: T; origin: Origin } => {
    if (key) {
      for (const l of layers) {
        const v = l.values[key];
        if (v !== null && v !== undefined) return { v: v as T, origin: l.origin };
      }
    }
    return { v: fallback, origin: "entorno" };
  };
  const m = pick<string | null>(MODEL_KEY[fn], envFunctionModel(fn, env) ?? null);
  // El asistente no tiene esfuerzo propio: lo da el modo (Rápido/Normal/Profundo).
  const e = fn === "assistant" ? { v: null, origin: "entorno" as Origin } : pick<AiEffort | null>(EFFORT_KEY[fn], envFunctionEffort(fn, env));
  return { model: m.v, modelLabel: modelLabel(m.v), effort: e.v, origin: m.origin, effortOrigin: e.origin };
}

function functionsOf(layers: Layer[]): Record<AiFunction, FunctionView> {
  return Object.fromEntries(AI_FUNCTIONS.map((fn) => [fn, effectiveFunction(fn, layers)])) as Record<AiFunction, FunctionView>;
}

const EMPTY_ROW: AiDefaultsRow = {
  agentModel: null,
  agentEffort: null,
  creatorModel: null,
  creatorEffort: null,
  assistantModel: null,
  monthlyUsdLimit: null,
  budgetMonthlyUsd: null,
  creditsUsd: null,
  creditsSince: null,
};

export type AiSettingsOverview = {
  scopes: Record<AiDefaultScope, AiDefaultsRow & { effective: Record<AiFunction, FunctionView> }>;
  catalog: { id: string; label: string; price: (ModelPrice & { source: "platform" | "known" }) | null }[];
  budget: {
    monthlyUsd: number | null;
    creditsUsd: number | null;
    creditsSince: string | null;
    spentSinceCredits: number | null;
    spentThisMonth: number;
  };
};

export async function getAiSettingsOverview(now = new Date()): Promise<AiSettingsOverview> {
  const defaults = await getPlatformAiDefaults();
  const instance = defaults.instance ?? EMPTY_ROW;
  const scopes = {} as AiSettingsOverview["scopes"];
  for (const scope of AI_DEFAULT_SCOPES) {
    const row = defaults[scope] ?? EMPTY_ROW;
    const layers: Layer[] =
      scope === "instance"
        ? [{ origin: "instancia", values: row }]
        : [
            { origin: "plan", values: row },
            { origin: "instancia", values: instance },
          ];
    scopes[scope] = { ...row, effective: functionsOf(layers) };
  }
  // El catálogo, más cualquier modelo con precio capturado que no esté en él.
  const own = await getModelPriceRows();
  const ids = [...MODEL_CATALOG.map((m) => m.id), ...[...own.keys()].filter((id) => !MODEL_CATALOG.some((m) => m.id === id))];
  const catalog = await Promise.all(ids.map(async (id) => ({ id, label: modelLabel(id), price: await priceOfModel(id) })));
  const period = currentPeriod(now);
  return {
    scopes,
    catalog,
    budget: {
      monthlyUsd: instance.budgetMonthlyUsd,
      creditsUsd: instance.creditsUsd,
      creditsSince: instance.creditsSince,
      spentSinceCredits: instance.creditsSince ? await platformEstSpendSince(instance.creditsSince) : null,
      spentThisMonth: await platformEstSpendSince(period),
    },
  };
}

export async function changePlatformAiDefaults(scope: AiDefaultScope, patch: AiDefaultsPatch, actor: AuditActor, ip: string | null): Promise<void> {
  const before = (await getPlatformAiDefaults())[scope] ?? EMPTY_ROW;
  await savePlatformAiDefaults(scope, patch, actor?.userId ?? null);
  const cambios = (Object.keys(patch) as (keyof AiDefaultsPatch)[]).filter((k) => before[k] !== patch[k]);
  if (cambios.length > 0) {
    await recordPlatformAudit({
      actor,
      action: "ai_settings.changed",
      detail: { alcance: scope, ...Object.fromEntries(cambios.map((k) => [k, { de: before[k], a: patch[k] }])) },
      ip,
    });
  }
}

export async function changeModelPrice(model: string, price: ModelPrice | null, actor: AuditActor, ip: string | null): Promise<void> {
  await saveModelPrice(model, price, actor?.userId ?? null);
  await recordPlatformAudit({ actor, action: "ai_settings.changed", detail: { modelo: model.trim(), precio: price }, ip });
}

export type OrgAiView = {
  plan: string | null;
  overrides: OrgAiOverrides;
  /** Lo que aplicaría sin lo propio (plan → instancia → entorno). */
  inherited: Record<AiFunction, FunctionView> & { monthlyUsdLimit: number | null };
  effective: Record<AiFunction, FunctionView> & { monthlyUsdLimit: number | null };
  spentThisMonth: number;
};

async function orgName(organizationId: string): Promise<{ id: string; name: string }> {
  const [org] = await getSystemDb()
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  if (!org) throw new PlatformError(404, "not_found", "Organización no encontrada");
  return org;
}

export async function getOrgAiView(organizationId: string, now = new Date()): Promise<OrgAiView> {
  await orgName(organizationId);
  const [state, defaults, spent] = await runWithOrganization(organizationId, () =>
    Promise.all([getOrgAiState(organizationId), getPlatformAiDefaults(), orgEstSpend(organizationId, currentPeriod(now))])
  );
  const plan = state.plan ? (defaults[state.plan] ?? EMPTY_ROW) : EMPTY_ROW;
  const instance = defaults.instance ?? EMPTY_ROW;
  const heredadas: Layer[] = [
    ...(state.plan ? [{ origin: "plan" as Origin, values: plan }] : []),
    { origin: "instancia", values: instance },
  ];
  const planUsd = state.plan ? plan.monthlyUsdLimit : null;
  return {
    plan: state.plan,
    overrides: state.overrides,
    inherited: { ...functionsOf(heredadas), monthlyUsdLimit: planUsd },
    effective: {
      ...functionsOf([{ origin: "empresa", values: state.overrides }, ...heredadas]),
      monthlyUsdLimit: state.overrides.monthlyUsdLimit ?? planUsd,
    },
    spentThisMonth: spent,
  };
}

export async function changeOrgAi(
  organizationId: string,
  patch: Partial<OrgAiOverrides>,
  actor: AuditActor,
  ip: string | null
): Promise<OrgAiView> {
  const org = await orgName(organizationId);
  const before = (await runWithOrganization(organizationId, () => getOrgAiState(organizationId))).overrides;
  await runWithOrganization(organizationId, () => saveOrgAiOverrides(organizationId, patch));
  const cambios = (Object.keys(patch) as (keyof OrgAiOverrides)[]).filter((k) => before[k] !== patch[k]);
  if (cambios.length > 0) {
    await recordPlatformAudit({
      actor,
      action: "organization.ai_changed",
      org,
      detail: Object.fromEntries(cambios.map((k) => [k, { de: before[k], a: patch[k] }])),
      ip,
    });
  }
  return getOrgAiView(organizationId);
}
