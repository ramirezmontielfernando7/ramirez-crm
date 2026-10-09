import { and, eq } from "drizzle-orm";
import { getSystemDb, schema, type Db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { AI_KINDS, emptyStorageUsage, type AiUsageKind, type StorageUsage } from "@/lib/usage";
import { agentNames } from "@/server/agents/store";
import { currentPeriod, getAgentUsage, getUsageSummary, type QuotaLimits } from "@/server/ai-quota/quota";
import { getAllOrgsStorageUsage, getOrgStorageUsage } from "@/server/usage/storage";

/**
 * 036 (PR 4) — Consumo de cada organización para /platform: IA del mes (UTC)
 * contra su tope y almacenamiento aproximado. SOLO LECTURA y solo números:
 * nunca contenido de un negocio. Detrás de `withPlatformAdmin` (404 a todos
 * los demás).
 *
 * - `listOrgsUsage()`: el resumen de TODAS para la lista, en pocas consultas
 *   agrupadas (pool de sistema), sin importar cuántas organizaciones haya.
 * - `getOrgUsageDetail(org)`: el detalle de UNA al abrir su fila, a nombre de
 *   esa organización (pool de la app, RLS), con las mismas lecturas que usará
 *   «Uso y plan» del Propietario.
 */

export type AiTotals = { turns: number; tokens: number };

export type OrgUsageSummary = {
  period: string;
  ai: AiTotals & { limits: QuotaLimits };
  storageBytes: number;
  /** 036 (PR 3a) — Plan y topes propios (sin fila: «Personalizado» y sin topes). */
  plan: {
    planKey: "custom";
    storageLimitBytes: number | null;
    storageMode: "warn" | "block_uploads";
    maxModules: number | null;
    maxMembers: number | null;
  };
  /** 036 (PR 3a) — Avisos del mes: el umbral más alto de cada medida. */
  alerts: { metric: string; threshold: number }[];
};

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys(): Db {
  return getSystemDb();
}

/** Sin fila propia (o NULL), el tope del entorno; sin él, sin tope (igual que `getQuotaLimits`). */
function withEnvDefaults(row: { turns: number | null; tokens: number | null } | undefined): QuotaLimits {
  const env = getEnv();
  return {
    turns: row?.turns ?? env.AI_DEFAULT_MONTHLY_TURNS ?? null,
    tokens: row?.tokens ?? env.AI_DEFAULT_MONTHLY_TOKENS ?? null,
  };
}

/** El resumen de consumo de cada organización de `ids` (cinco lecturas agrupadas en total). */
export async function listOrgsUsage(ids: string[], now = new Date()): Promise<Map<string, OrgUsageSummary>> {
  const out = new Map<string, OrgUsageSummary>();
  if (ids.length === 0) return out;
  const period = currentPeriod(now);
  const db = sys();
  const [totales, topes, almacen, planes, avisos] = await Promise.all([
    db
      .select({
        org: schema.aiUsage.organizationId,
        turns: schema.aiUsage.turns,
        prompt: schema.aiUsage.promptTokens,
        completion: schema.aiUsage.completionTokens,
      })
      .from(schema.aiUsage)
      .where(and(eq(schema.aiUsage.period, period), eq(schema.aiUsage.kind, "total"))),
    db
      .select({
        org: schema.aiQuota.organizationId,
        turns: schema.aiQuota.monthlyTurnLimit,
        tokens: schema.aiQuota.monthlyTokenLimit,
      })
      .from(schema.aiQuota),
    getAllOrgsStorageUsage(),
    db
      .select({
        org: schema.organizationPlan.organizationId,
        storageLimitBytes: schema.organizationPlan.storageLimitBytes,
        storageMode: schema.organizationPlan.storageMode,
        maxModules: schema.organizationPlan.maxActiveModules,
        maxMembers: schema.organizationPlan.maxMembers,
      })
      .from(schema.organizationPlan),
    db
      .select({ org: schema.usageAlert.organizationId, metric: schema.usageAlert.metric, threshold: schema.usageAlert.threshold })
      .from(schema.usageAlert)
      .where(eq(schema.usageAlert.period, period)),
  ]);
  const total = new Map(totales.map((r) => [r.org, r]));
  const tope = new Map(topes.map((r) => [r.org, r]));
  const plan = new Map(planes.map((r) => [r.org, r]));
  const avisosPorOrg = new Map<string, Map<string, number>>();
  for (const a of avisos) {
    const m = avisosPorOrg.get(a.org) ?? new Map<string, number>();
    m.set(a.metric, Math.max(m.get(a.metric) ?? 0, a.threshold));
    avisosPorOrg.set(a.org, m);
  }
  for (const id of ids) {
    const t = total.get(id);
    out.set(id, {
      period,
      ai: { turns: t?.turns ?? 0, tokens: (t?.prompt ?? 0) + (t?.completion ?? 0), limits: withEnvDefaults(tope.get(id)) },
      storageBytes: (almacen.get(id) ?? emptyStorageUsage()).totalBytes,
      plan: {
        planKey: "custom",
        storageLimitBytes: plan.get(id)?.storageLimitBytes ?? null,
        storageMode: plan.get(id)?.storageMode ?? "warn",
        maxModules: plan.get(id)?.maxModules ?? null,
        maxMembers: plan.get(id)?.maxMembers ?? null,
      },
      alerts: [...(avisosPorOrg.get(id) ?? new Map<string, number>())].map(([metric, threshold]) => ({ metric, threshold })),
    });
  }
  return out;
}

export type AgentUsageLine = {
  agentId: string;
  /** Nombre interno del agente; `null` si ya no existe. */
  name: string | null;
  archived: boolean;
  turns: number;
  tokens: number;
  byKind: Partial<Record<"agent" | "lab" | "judge", AiTotals>>;
};

export type OrgUsageDetail = {
  period: string;
  ai: AiTotals & {
    limits: QuotaLimits;
    /** Por función (agent, lab, judge, writing y, aparte, embed). */
    byKind: Partial<Record<AiUsageKind, AiTotals>>;
    /** Por agente, de mayor a menor consumo. La escritura y los embeddings no tienen agente. */
    byAgent: AgentUsageLine[];
  };
  storage: StorageUsage;
};

/** El detalle de UNA organización, leído a nombre de ella (RLS). */
export async function getOrgUsageDetail(organizationId: string, now = new Date()): Promise<OrgUsageDetail> {
  return runWithOrganization(organizationId, async () => {
    const [resumen, porAgente, storage] = await Promise.all([
      getUsageSummary(organizationId, now),
      getAgentUsage(organizationId, now),
      getOrgStorageUsage(organizationId),
    ]);
    const nombres = await agentNames(organizationId, [...new Set(porAgente.map((r) => r.agentId))]);

    const byKind: OrgUsageDetail["ai"]["byKind"] = {};
    for (const k of AI_KINDS) {
      const v = resumen.byKind[k];
      if (v) byKind[k] = v;
    }

    const lineas = new Map<string, AgentUsageLine>();
    for (const r of porAgente) {
      const n = nombres.get(r.agentId);
      const linea =
        lineas.get(r.agentId) ??
        ({ agentId: r.agentId, name: n?.internalName ?? null, archived: n?.archived ?? true, turns: 0, tokens: 0, byKind: {} } satisfies AgentUsageLine);
      linea.turns += r.turns;
      linea.tokens += r.tokens;
      linea.byKind[r.kind] = { turns: r.turns, tokens: r.tokens };
      lineas.set(r.agentId, linea);
    }

    return {
      period: resumen.period,
      ai: {
        turns: resumen.turns,
        tokens: resumen.tokens,
        limits: resumen.limits,
        byKind,
        byAgent: [...lineas.values()].sort((a, b) => b.tokens - a.tokens || b.turns - a.turns),
      },
      storage,
    };
  });
}

/** ¿Existe la organización? (para responder 404 a un id que no existe). */
export async function organizationExists(organizationId: string): Promise<boolean> {
  const [row] = await sys()
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return Boolean(row);
}
