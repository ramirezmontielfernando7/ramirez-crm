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

/** 036 — Los tipos que tienen agente (la escritura y los embeddings no). */
export const AGENT_KINDS = ["agent", "lab", "judge"] as const;
export type AgentAiKind = (typeof AGENT_KINDS)[number];

export function isAgentKind(kind: string): kind is AgentAiKind {
  return (AGENT_KINDS as readonly string[]).includes(kind);
}

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

/** 036 (PR 3b) — Un costo reportado utilizable (USD ≥ 0), o 0. */
function costOf(usage: { costUsd?: number } | null | undefined): number {
  const c = usage?.costUsd;
  return typeof c === "number" && Number.isFinite(c) && c > 0 ? c : 0;
}

/**
 * Suma los tokens que reportó el proveedor (al total y al tipo) y, desde
 * 036 (PR 3b), su costo real (`cost_usd`) cuando el proveedor lo manda.
 */
export async function recordUsage(
  organizationId: string,
  kind: AiKind,
  usage: LlmUsage,
  now = new Date()
): Promise<void> {
  const cost = costOf(usage);
  if (usage.promptTokens === 0 && usage.completionTokens === 0 && cost === 0) return;
  const period = currentPeriod(now);
  for (const k of [TOTAL, kind]) {
    await getDb()
      .update(schema.aiUsage)
      .set({
        promptTokens: sql`${schema.aiUsage.promptTokens} + ${usage.promptTokens}`,
        completionTokens: sql`${schema.aiUsage.completionTokens} + ${usage.completionTokens}`,
        costUsd: sql`${schema.aiUsage.costUsd} + ${cost}`,
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

/**
 * 036 (PR 1) — El mismo turno, anotado al AGENTE que lo pidió
 * (`ai_usage_agent`). Solo reporta: no se compara contra ningún tope (eso ya
 * lo hizo `reserveTurn` sobre la fila `total`). Un turno y sus tokens en una
 * sola sentencia; el turno cuenta aunque el proveedor haya fallado, igual que
 * en `ai_usage`.
 */
export async function recordAgentUsage(
  organizationId: string,
  agentId: string,
  kind: AgentAiKind,
  usage: LlmUsage | null,
  now = new Date()
): Promise<void> {
  const period = currentPeriod(now);
  const prompt = Math.max(0, Math.floor(usage?.promptTokens ?? 0));
  const completion = Math.max(0, Math.floor(usage?.completionTokens ?? 0));
  const cost = costOf(usage);
  await getDb()
    .insert(schema.aiUsageAgent)
    .values({ organizationId, period, agentId, kind, turns: 1, promptTokens: prompt, completionTokens: completion, costUsd: String(cost) })
    .onConflictDoUpdate({
      target: [
        schema.aiUsageAgent.organizationId,
        schema.aiUsageAgent.period,
        schema.aiUsageAgent.agentId,
        schema.aiUsageAgent.kind,
      ],
      set: {
        turns: sql`${schema.aiUsageAgent.turns} + 1`,
        promptTokens: sql`${schema.aiUsageAgent.promptTokens} + ${prompt}`,
        completionTokens: sql`${schema.aiUsageAgent.completionTokens} + ${completion}`,
        costUsd: sql`${schema.aiUsageAgent.costUsd} + ${cost}`,
        updatedAt: new Date(),
      },
    });
}

export type AgentUsageRow = { agentId: string; kind: AgentAiKind; turns: number; tokens: number };

/** 036 — El consumo del mes de la organización por agente y tipo. */
export async function getAgentUsage(organizationId: string, now = new Date()): Promise<AgentUsageRow[]> {
  const rows = await getDb()
    .select()
    .from(schema.aiUsageAgent)
    .where(
      scoped(schema.aiUsageAgent.organizationId, organizationId, eq(schema.aiUsageAgent.period, currentPeriod(now)))
    );
  return rows.map((r) => ({
    agentId: r.agentId,
    kind: r.kind,
    turns: r.turns,
    tokens: r.promptTokens + r.completionTokens,
  }));
}

/**
 * 035 — Los EMBEDDINGS (documentos del agente) se llevan en su propia fila
 * (`kind = 'embed'`): `turns` = llamadas al servicio, `prompt_tokens` = tokens
 * embebidos. NO suman a la fila `total`: no gastan los turnos ni los tokens
 * del agente (con el contenedor local son gratis). Su tope, si lo hay, es
 * `AI_DEFAULT_MONTHLY_EMBED_TOKENS` (`embedTokensUsed`).
 */
export const EMBED_KIND = "embed";

export async function recordEmbedUsage(
  organizationId: string,
  tokens: number,
  now = new Date(),
  costUsd?: number
): Promise<void> {
  const period = currentPeriod(now);
  const cost = costOf({ costUsd });
  await getDb()
    .insert(schema.aiUsage)
    .values({ organizationId, period, kind: EMBED_KIND, turns: 1, promptTokens: Math.max(0, Math.floor(tokens)), costUsd: String(cost) })
    .onConflictDoUpdate({
      target: [schema.aiUsage.organizationId, schema.aiUsage.period, schema.aiUsage.kind],
      set: {
        turns: sql`${schema.aiUsage.turns} + 1`,
        promptTokens: sql`${schema.aiUsage.promptTokens} + ${Math.max(0, Math.floor(tokens))}`,
        costUsd: sql`${schema.aiUsage.costUsd} + ${cost}`,
        updatedAt: new Date(),
      },
    });
}

/** Tokens de embeddings del mes (para su tope). */
export async function embedTokensUsed(organizationId: string, now = new Date()): Promise<number> {
  const [row] = await getDb()
    .select({ t: schema.aiUsage.promptTokens })
    .from(schema.aiUsage)
    .where(
      scoped(
        schema.aiUsage.organizationId,
        organizationId,
        eq(schema.aiUsage.period, currentPeriod(now)),
        eq(schema.aiUsage.kind, EMBED_KIND)
      )
    )
    .limit(1);
  return row?.t ?? 0;
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
