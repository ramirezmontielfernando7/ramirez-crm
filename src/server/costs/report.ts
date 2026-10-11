import { eq, inArray } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import {
  costByKind,
  pricingAt,
  pricingMomentFor,
  projectionBase,
  projectMonth,
  sumCosts,
  monthElapsed,
  type CostReport,
  type OrgCostLine,
} from "@/lib/costs";
import { currentPeriod } from "@/server/ai-quota/quota";
import { listPricing } from "./pricing";

/**
 * 036 (PR 3b) — El panel de costos de la plataforma: cuánto le cuesta la IA
 * de cada organización este mes (estimado con los precios capturados y real
 * reportado por OpenRouter), su proyección a fin de mes, en USD y en la
 * moneda local. SOLO LECTURA y solo números (tokens y montos), nunca
 * contenido. Detrás de `withPlatformAdmin`.
 *
 * Una lectura agrupada de `ai_usage` para todas las organizaciones (pool de
 * sistema), sin importar cuántas haya.
 */

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys() {
  return getSystemDb();
}

const sumOrNull = (xs: (number | null)[]): number | null =>
  xs.some((x) => x !== null) ? xs.reduce<number>((n, x) => n + (x ?? 0), 0) : null;

export async function getCostReport(now = new Date()): Promise<CostReport> {
  const period = currentPeriod(now);
  const db = sys();
  const [uso, historial] = await Promise.all([
    db
      .select({
        org: schema.aiUsage.organizationId,
        kind: schema.aiUsage.kind,
        promptTokens: schema.aiUsage.promptTokens,
        completionTokens: schema.aiUsage.completionTokens,
        costUsd: schema.aiUsage.costUsd,
      })
      .from(schema.aiUsage)
      .where(eq(schema.aiUsage.period, period)),
    listPricing(),
  ]);
  // Solo las organizaciones con consumo este mes (las demás no ocupan renglón).
  const ids = [...new Set(uso.map((r) => r.org))];
  const orgs =
    ids.length === 0
      ? []
      : await db
          .select({ id: schema.organization.id, name: schema.organization.name, status: schema.organization.status })
          .from(schema.organization)
          .where(inArray(schema.organization.id, ids));
  const pricing = pricingAt(historial, pricingMomentFor(period, now));

  const porOrg = new Map<string, { kind: string; promptTokens: number; completionTokens: number; costUsd: number }[]>();
  for (const r of uso) {
    const lista = porOrg.get(r.org) ?? [];
    lista.push({ kind: r.kind, promptTokens: r.promptTokens, completionTokens: r.completionTokens, costUsd: Number(r.costUsd) });
    porOrg.set(r.org, lista);
  }

  const rows: OrgCostLine[] = [];
  for (const o of orgs) {
    const filas = porOrg.get(o.id);
    if (!filas) continue;
    const byKind = costByKind(filas, pricing);
    if (byKind.length === 0) continue;
    const t = sumCosts(byKind, pricing !== null);
    rows.push({
      organizationId: o.id,
      name: o.name,
      status: o.status,
      estimatedUsd: t.estimatedUsd,
      realUsd: t.realUsd,
      projectedUsd: projectMonth(projectionBase(t), period, now),
      byKind,
    });
  }
  rows.sort((a, b) => (b.realUsd ?? b.estimatedUsd ?? 0) - (a.realUsd ?? a.estimatedUsd ?? 0) || a.name.localeCompare(b.name));

  return {
    period,
    elapsed: monthElapsed(period, now),
    pricing,
    rows,
    totals: {
      estimatedUsd: sumOrNull(rows.map((r) => r.estimatedUsd)),
      realUsd: sumOrNull(rows.map((r) => r.realUsd)),
      projectedUsd: sumOrNull(rows.map((r) => r.projectedUsd)),
    },
  };
}
