import { eq, sql } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { parseEffort, type AiEffort } from "@/lib/ai/choice";
import { suggestedPriceFor } from "@/lib/costs";

/**
 * 0070 — Lo que elige el administrador de plataforma para TODAS las
 * organizaciones: los «Modelos de Dashfort» (scope `instance`), los valores
 * de cada plan (`esencial` | `pro` | `ultra`) y el precio de cada modelo.
 * Tablas de PLATAFORMA: solo el pool de sistema. Se leen en cada turno de
 * IA, así que van con una caché de 60 s que se limpia al guardar.
 */

export const AI_DEFAULT_SCOPES = ["instance", "inicio", "esencial", "pro", "ultra"] as const;
export type AiDefaultScope = (typeof AI_DEFAULT_SCOPES)[number];
export const PLAN_SCOPES = ["inicio", "esencial", "pro", "ultra"] as const;

export type AiFunctionValues = {
  agentModel: string | null;
  agentEffort: AiEffort | null;
  creatorModel: string | null;
  creatorEffort: AiEffort | null;
  assistantModel: string | null;
};

export type AiDefaultsRow = AiFunctionValues & {
  monthlyUsdLimit: number | null;
  budgetMonthlyUsd: number | null;
  creditsUsd: number | null;
  creditsSince: string | null;
};

export type ModelPrice = { inputUsdPerMtok: number; outputUsdPerMtok: number };

const TTL_MS = 60_000;
let defaultsCache: { at: number; rows: Partial<Record<AiDefaultScope, AiDefaultsRow>> } | null = null;
let pricesCache: { at: number; rows: Map<string, ModelPrice> } | null = null;

export function clearAiSettingsCache(): void {
  defaultsCache = null;
  pricesCache = null;
}

const num = (v: string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: string | null | undefined): string | null => v?.trim() || null;

export async function getPlatformAiDefaults(): Promise<Partial<Record<AiDefaultScope, AiDefaultsRow>>> {
  if (defaultsCache && Date.now() - defaultsCache.at < TTL_MS) return defaultsCache.rows;
  const rows = await getSystemDb().select().from(schema.platformAiDefaults);
  const out: Partial<Record<AiDefaultScope, AiDefaultsRow>> = {};
  for (const r of rows) {
    if (!(AI_DEFAULT_SCOPES as readonly string[]).includes(r.scope)) continue;
    out[r.scope as AiDefaultScope] = {
      agentModel: txt(r.agentModel),
      agentEffort: parseEffort(r.agentEffort) ?? null,
      creatorModel: txt(r.creatorModel),
      creatorEffort: parseEffort(r.creatorEffort) ?? null,
      assistantModel: txt(r.assistantModel),
      monthlyUsdLimit: num(r.monthlyUsdLimit),
      budgetMonthlyUsd: num(r.budgetMonthlyUsd),
      creditsUsd: num(r.creditsUsd),
      creditsSince: r.creditsSince,
    };
  }
  defaultsCache = { at: Date.now(), rows: out };
  return out;
}

export type AiDefaultsPatch = Partial<AiDefaultsRow>;

export async function savePlatformAiDefaults(scope: AiDefaultScope, patch: AiDefaultsPatch, actorUserId: string | null): Promise<void> {
  const db = getSystemDb();
  const [actual] = await db.select().from(schema.platformAiDefaults).where(eq(schema.platformAiDefaults.scope, scope)).limit(1);
  const pick = <K extends keyof AiDefaultsPatch>(k: K, cur: unknown) => (patch[k] === undefined ? cur : patch[k]);
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const values = {
    agentModel: pick("agentModel", actual?.agentModel ?? null) as string | null,
    agentEffort: pick("agentEffort", actual?.agentEffort ?? null) as string | null,
    creatorModel: pick("creatorModel", actual?.creatorModel ?? null) as string | null,
    creatorEffort: pick("creatorEffort", actual?.creatorEffort ?? null) as string | null,
    assistantModel: pick("assistantModel", actual?.assistantModel ?? null) as string | null,
    monthlyUsdLimit: str(pick("monthlyUsdLimit", actual?.monthlyUsdLimit ?? null)),
    budgetMonthlyUsd: str(pick("budgetMonthlyUsd", actual?.budgetMonthlyUsd ?? null)),
    creditsUsd: str(pick("creditsUsd", actual?.creditsUsd ?? null)),
    creditsSince: pick("creditsSince", actual?.creditsSince ?? null) as string | null,
    updatedAt: new Date(),
    updatedBy: actorUserId,
  };
  await db
    .insert(schema.platformAiDefaults)
    .values({ scope, ...values })
    .onConflictDoUpdate({ target: schema.platformAiDefaults.scope, set: values });
  clearAiSettingsCache();
}

/** Los precios que capturó el administrador (sin los de la lista conocida). */
export async function getModelPriceRows(): Promise<Map<string, ModelPrice>> {
  if (pricesCache && Date.now() - pricesCache.at < TTL_MS) return pricesCache.rows;
  const rows = await getSystemDb().select().from(schema.platformAiModelPrice);
  const map = new Map<string, ModelPrice>();
  for (const r of rows) map.set(r.model, { inputUsdPerMtok: Number(r.inputUsdPerMtok), outputUsdPerMtok: Number(r.outputUsdPerMtok) });
  pricesCache = { at: Date.now(), rows: map };
  return map;
}

export async function saveModelPrice(model: string, price: ModelPrice | null, actorUserId: string | null): Promise<void> {
  const db = getSystemDb();
  const m = model.trim();
  if (!price) {
    await db.delete(schema.platformAiModelPrice).where(eq(schema.platformAiModelPrice.model, m));
  } else {
    const values = {
      inputUsdPerMtok: String(price.inputUsdPerMtok),
      outputUsdPerMtok: String(price.outputUsdPerMtok),
      updatedAt: new Date(),
      updatedBy: actorUserId,
    };
    await db
      .insert(schema.platformAiModelPrice)
      .values({ model: m, ...values })
      .onConflictDoUpdate({ target: schema.platformAiModelPrice.model, set: values });
  }
  clearAiSettingsCache();
}

/** El precio de un modelo: el capturado o, sin él, el de la lista conocida. */
export async function priceOfModel(model: string | null | undefined): Promise<(ModelPrice & { source: "platform" | "known" }) | null> {
  const m = model?.trim();
  if (!m) return null;
  const own = (await getModelPriceRows()).get(m);
  if (own) return { ...own, source: "platform" };
  const known = suggestedPriceFor(m);
  return known ? { inputUsdPerMtok: known.inputUsdPerMtok, outputUsdPerMtok: known.outputUsdPerMtok, source: "known" } : null;
}

/** Gasto ESTIMADO de la plataforma desde un mes (todas las organizaciones). */
export async function platformEstSpendSince(period: string): Promise<number> {
  const [row] = await getSystemDb()
    .select({ usd: sql<string>`coalesce(sum(${schema.aiUsage.estCostUsd}), 0)` })
    .from(schema.aiUsage)
    .where(sql`${schema.aiUsage.kind} = 'total' and ${schema.aiUsage.period} >= ${period}`);
  return Number(row?.usd ?? 0);
}
