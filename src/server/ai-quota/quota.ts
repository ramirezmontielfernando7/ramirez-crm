import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import type { LlmUsage } from "@/lib/ai";

/**
 * Fase 3, PR 1 — Cuota mensual de IA por organización.
 *
 * La llave de OpenRouter es de la plataforma y la comparten todas las
 * organizaciones: sin tope, una sola puede gastársela. Cada llamada al modelo
 * (un "turno": agente, Laboratorio, juez o asistente de redacción) se RESERVA
 * antes de hacerse, contra el tope del mes calendario en UTC:
 *
 * - Turnos: `monthly_turn_limit`. Atómico: dos turnos a la vez no pasan los
 *   dos si solo cabía uno.
 * - Tokens: `monthly_token_limit` (entrada + salida). Se conoce DESPUÉS de la
 *   llamada, así que el último turno puede pasarse un poco; el siguiente ya
 *   no entra.
 *
 * Sin fila en `ai_quota` (o con NULL) valen `AI_DEFAULT_MONTHLY_TURNS` /
 * `AI_DEFAULT_MONTHLY_TOKENS`; sin ellas, no hay tope. El consumo se lleva en
 * `ai_usage` por tipo, más una fila `total` que es la que se compara.
 *
 * Todo con el pool de la APP a nombre de la organización (RLS) y FUERA de
 * transacción: el LLM nunca se llama con una abierta.
 */

export type AiKind = "agent" | "lab" | "judge" | "writing";

const TOTAL = "total";

export type QuotaLimits = { turns: number | null; tokens: number | null };

export type Reservation = { ok: true } | { ok: false; limit: "turns" | "tokens" };

/** Primer día del mes en UTC, 'YYYY-MM-01'. */
export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Los topes que aplican a la organización este mes. */
export async function getQuotaLimits(organizationId: string): Promise<QuotaLimits> {
  const [row] = await getDb()
    .select({ turns: schema.aiQuota.monthlyTurnLimit, tokens: schema.aiQuota.monthlyTokenLimit })
    .from(schema.aiQuota)
    .where(scoped(schema.aiQuota.organizationId, organizationId))
    .limit(1);
  const env = getEnv();
  return {
    turns: row?.turns ?? env.AI_DEFAULT_MONTHLY_TURNS ?? null,
    tokens: row?.tokens ?? env.AI_DEFAULT_MONTHLY_TOKENS ?? null,
  };
}

/**
 * Reserva un turno. `ok: false` si la organización ya llegó a su tope de
 * turnos o de tokens del mes. Cuenta el turno aunque luego el proveedor
 * falle: la llamada (y sus reintentos) se hizo igual.
 */
export async function reserveTurn(
  organizationId: string,
  kind: AiKind,
  now = new Date()
): Promise<Reservation> {
  const period = currentPeriod(now);
  const limits = await getQuotaLimits(organizationId);
  const db = getDb();

  await db
    .insert(schema.aiUsage)
    .values({ organizationId, period, kind: TOTAL })
    .onConflictDoNothing();

  // Una sola sentencia: suma el turno SOLO si cabe. Bajo concurrencia, Postgres
  // re-evalúa el WHERE con la fila ya actualizada por el otro: no se cuelan dos.
  const reserved = await db
    .update(schema.aiUsage)
    .set({ turns: sql`${schema.aiUsage.turns} + 1`, updatedAt: new Date() })
    .where(
      and(
        scoped(schema.aiUsage.organizationId, organizationId),
        eq(schema.aiUsage.period, period),
        eq(schema.aiUsage.kind, TOTAL),
        limits.turns === null ? sql`true` : sql`${schema.aiUsage.turns} < ${limits.turns}`,
        limits.tokens === null
          ? sql`true`
          : sql`${schema.aiUsage.promptTokens} + ${schema.aiUsage.completionTokens} < ${limits.tokens}`
      )
    )
    .returning({ turns: schema.aiUsage.turns });
  if (reserved.length === 0) {
    const [row] = await db
      .select({ turns: schema.aiUsage.turns, p: schema.aiUsage.promptTokens, c: schema.aiUsage.completionTokens })
      .from(schema.aiUsage)
      .where(
        and(
          scoped(schema.aiUsage.organizationId, organizationId),
          eq(schema.aiUsage.period, period),
          eq(schema.aiUsage.kind, TOTAL)
        )
      )
      .limit(1);
    const turnsFull = limits.turns !== null && (row?.turns ?? 0) >= limits.turns;
    return { ok: false, limit: turnsFull ? "turns" : "tokens" };
  }

  // El desglose por tipo (no se compara contra nada; solo se reporta).
  await db
    .insert(schema.aiUsage)
    .values({ organizationId, period, kind, turns: 1 })
    .onConflictDoUpdate({
      target: [schema.aiUsage.organizationId, schema.aiUsage.period, schema.aiUsage.kind],
      set: { turns: sql`${schema.aiUsage.turns} + 1`, updatedAt: new Date() },
    });
  return { ok: true };
}

/** Suma los tokens que reportó el proveedor (al total y al tipo). */
export async function recordUsage(
  organizationId: string,
  kind: AiKind,
  usage: LlmUsage,
  now = new Date()
): Promise<void> {
  if (usage.promptTokens === 0 && usage.completionTokens === 0) return;
  const period = currentPeriod(now);
  for (const k of [TOTAL, kind]) {
    await getDb()
      .update(schema.aiUsage)
      .set({
        promptTokens: sql`${schema.aiUsage.promptTokens} + ${usage.promptTokens}`,
        completionTokens: sql`${schema.aiUsage.completionTokens} + ${usage.completionTokens}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          scoped(schema.aiUsage.organizationId, organizationId),
          eq(schema.aiUsage.period, period),
          eq(schema.aiUsage.kind, k)
        )
      );
  }
}

export type UsageSummary = {
  period: string;
  limits: QuotaLimits;
  turns: number;
  tokens: number;
  byKind: Record<string, { turns: number; tokens: number }>;
};

/** El consumo del mes de la organización (para scripts y, en el PR 2, /platform). */
export async function getUsageSummary(organizationId: string, now = new Date()): Promise<UsageSummary> {
  const period = currentPeriod(now);
  const rows = await getDb()
    .select()
    .from(schema.aiUsage)
    .where(scoped(schema.aiUsage.organizationId, organizationId, eq(schema.aiUsage.period, period)));
  const byKind: UsageSummary["byKind"] = {};
  let turns = 0;
  let tokens = 0;
  for (const r of rows) {
    const t = r.promptTokens + r.completionTokens;
    if (r.kind === TOTAL) {
      turns = r.turns;
      tokens = t;
    } else {
      byKind[r.kind] = { turns: r.turns, tokens: t };
    }
  }
  return { period, limits: await getQuotaLimits(organizationId), turns, tokens, byKind };
}
