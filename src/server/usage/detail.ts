import { AI_KINDS, type AiUsageKind, type StorageUsage } from "@/lib/usage";
import { agentNames } from "@/server/agents/store";
import { getAgentUsage, getUsageSummary, type QuotaLimits } from "@/server/ai-quota/quota";
import { getOrgStorageUsage } from "@/server/usage/storage";

/**
 * 036 — El consumo del mes de UNA organización (IA por función y por agente,
 * almacenamiento aproximado por categoría). Lo comparten Plataforma →
 * Organizaciones (PR 4, al abrir una fila) y «Uso y plan» del Propietario
 * (PR 6). Solo lectura y solo números.
 */

export type AiTotals = { turns: number; tokens: number };

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

/**
 * El detalle del mes de UNA organización. Corre a nombre de ella: quien llama
 * ya está en su contexto (`withAuth` del Propietario, o `runWithOrganization`
 * desde la plataforma). Pool de la app, RLS y `scoped()` en cada lectura.
 */
export async function readOrgUsageDetail(organizationId: string, now = new Date()): Promise<OrgUsageDetail> {
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
}

