import { and, countDistinct, eq, gte, isNull, sql } from "drizzle-orm";
import { getSystemDb, schema, type Db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { isPlanKey, type PlanKey } from "@/lib/limits";
import { emptyStorageUsage } from "@/lib/usage";
import { currentPeriod, type QuotaLimits } from "@/server/ai-quota/quota";
import { readOrgUsageDetail, type OrgUsageDetail } from "@/server/usage/detail";
import { getAllOrgsStorageUsage } from "@/server/usage/storage";

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
    planKey: PlanKey;
    storageLimitBytes: number | null;
    storageMode: "warn" | "block_uploads";
    maxModules: number | null;
    maxMembers: number | null;
  };
  /** 036 (PR 3a) — Avisos del mes: el umbral más alto de cada medida. */
  alerts: { metric: string; threshold: number }[];
  /**
   * 047 PR 5 — Conector de IA: personas con una IA conectada hoy, y en el
   * mes (UTC) cuántas acciones pidió y cuántos mensajes mandó. Solo números.
   */
  aiConnector: { people: number; actions: number; sent: number };
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

/** El resumen de consumo de cada organización de `ids` (siete lecturas agrupadas en total). */
export async function listOrgsUsage(ids: string[], now = new Date()): Promise<Map<string, OrgUsageSummary>> {
  const out = new Map<string, OrgUsageSummary>();
  if (ids.length === 0) return out;
  const period = currentPeriod(now);
  const db = sys();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [totales, topes, almacen, planes, avisos, conectadas, acciones] = await Promise.all([
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
        planKey: schema.organizationPlan.planKey,
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
    db
      .select({ org: schema.aiConnection.organizationId, people: countDistinct(schema.aiConnection.userId) })
      .from(schema.aiConnection)
      .where(isNull(schema.aiConnection.revokedAt))
      .groupBy(schema.aiConnection.organizationId),
    db
      .select({
        org: schema.aiActionLog.organizationId,
        actions: sql<number>`count(*)::int`,
        sent: sql<number>`count(*) filter (where ${schema.aiActionLog.tool} = 'send_message' and ${schema.aiActionLog.outcome} = 'ok')::int`,
      })
      .from(schema.aiActionLog)
      .where(gte(schema.aiActionLog.at, monthStart))
      .groupBy(schema.aiActionLog.organizationId),
  ]);
  const conectadasPorOrg = new Map(conectadas.map((r) => [r.org, Number(r.people)]));
  const accionesPorOrg = new Map(acciones.map((r) => [r.org, r]));
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
        planKey: isPlanKey(plan.get(id)?.planKey) ? (plan.get(id)!.planKey as PlanKey) : "custom",
        storageLimitBytes: plan.get(id)?.storageLimitBytes ?? null,
        storageMode: plan.get(id)?.storageMode ?? "warn",
        maxModules: plan.get(id)?.maxModules ?? null,
        maxMembers: plan.get(id)?.maxMembers ?? null,
      },
      alerts: [...(avisosPorOrg.get(id) ?? new Map<string, number>())].map(([metric, threshold]) => ({ metric, threshold })),
      aiConnector: {
        people: conectadasPorOrg.get(id) ?? 0,
        actions: Number(accionesPorOrg.get(id)?.actions ?? 0),
        sent: Number(accionesPorOrg.get(id)?.sent ?? 0),
      },
    });
  }
  return out;
}

export type { AgentUsageLine, OrgUsageDetail } from "@/server/usage/detail";

/** El detalle de UNA organización, leído a nombre de ella (RLS). */
export async function getOrgUsageDetail(organizationId: string, now = new Date()): Promise<OrgUsageDetail> {
  return runWithOrganization(organizationId, () => readOrgUsageDetail(organizationId, now));
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
