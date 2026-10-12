import { countActiveModules } from "@/lib/platform-modules";
import { AI_ALERT_METRICS, alertText, type AlertMetric, type AlertThreshold, type EffectiveLimits, type UsageVisibility } from "@/lib/limits";
import type { AiUsageKind, StorageUsage } from "@/lib/usage";
import { projectGauge, projectShares, worstGauge, type Gauge, type ShareLine } from "@/lib/usage-visibility";
import { assistantTokensUsed, embedTokensUsed } from "@/server/ai-quota/quota";
import { orgHasKbDocs } from "@/server/kb-docs/flag";
import { getUsage as getKbDocUsage } from "@/server/kb-docs/store";
import { countMembers, getEffectiveLimits, getUsageVisibility, moduleToggles } from "@/server/limits";
import { listAlerts } from "@/server/limits/alerts";
import { getOrgModules } from "@/server/modules";
import { readOrgUsageDetail } from "./detail";

/**
 * 036 (PR 6) — «Uso y plan» del Propietario: lo que su organización consume
 * este mes contra sus topes (IA, embeddings, almacenamiento aprox.,
 * documentos del agente, personas y módulos), qué función y qué agente
 * consumen más, y los avisos del mes. Solo lectura, a nombre de SU
 * organización (pool de la app, RLS, `scoped()`): nunca ve otra. Sin costos
 * ni precios: eso es del administrador de plataforma.
 *
 * 038 (PR 1): la IA sale ya RECORTADA a la visibilidad que fijó el
 * administrador (`organization_plan.usage_visibility`): con `percent`, solo
 * porcentajes; con `status`, solo «Disponible» / «Agotado»; con `tokens`, las
 * cifras. Lo que no se debe ver no viaja en el JSON. Nunca dólares.
 */

/** Los topes que el cliente puede ver: todo menos los de IA (esos van dentro de cada medidor). */
export type OwnerLimits = Omit<EffectiveLimits, "aiTurns" | "aiTokens" | "embedTokens" | "assistantTokens">;

export type OwnerAiTotal = Gauge & {
  /** Solo con `tokens`: las dos medidas del total por separado. */
  tokens?: { used: number; limit: number | null };
  turns?: { used: number; limit: number | null };
};

export type OwnerAgentShare = ShareLine<string> & { name: string | null; archived: boolean };

export type OwnerAlert = {
  metric: AlertMetric;
  threshold: AlertThreshold;
  text: string;
  createdAt: string;
  seenAt: string | null;
  /** Solo con `tokens` (o en medidas que no son de IA). */
  used?: number;
  limit?: number;
};

export type OwnerUsage = {
  period: string;
  visibility: UsageVisibility;
  ai: {
    total: OwnerAiTotal;
    embed: Gauge;
    /** El asistente interno: solo si la organización tiene el módulo. */
    assistant: Gauge | null;
    /** Por función (sin embeddings) y por agente; `null` con `status`. */
    byKind: ShareLine<AiUsageKind>[] | null;
    byAgent: OwnerAgentShare[] | null;
  };
  storage: StorageUsage;
  limits: OwnerLimits;
  /** `null` si la organización no usa documentos (instancia sin KB_DOCS o sin Laboratorio). */
  documents: { documents: number; chunks: number } | null;
  members: number;
  modules: { active: number; total: number };
  alerts: OwnerAlert[];
};

/**
 * Los avisos del mes con su texto según la visibilidad. En las medidas de IA,
 * sin cifras salvo con `tokens`; si dos avisos dicen lo mismo (tokens y
 * turnos son «IA del mes»), queda uno.
 */
export async function listOwnerAlerts(
  organizationId: string,
  opts: { onlyUnseen?: boolean; now?: Date; visibility?: UsageVisibility } = {}
): Promise<OwnerAlert[]> {
  const visibility = opts.visibility ?? (await getUsageVisibility(organizationId));
  const alerts = await listAlerts(organizationId, { onlyUnseen: opts.onlyUnseen, now: opts.now });
  const out: OwnerAlert[] = [];
  const textos = new Set<string>();
  for (const a of alerts) {
    const text = alertText(a.metric, a.threshold, visibility);
    if (textos.has(text)) continue;
    textos.add(text);
    const cifras = visibility === "tokens" || !AI_ALERT_METRICS.includes(a.metric);
    out.push({
      metric: a.metric,
      threshold: a.threshold,
      text,
      createdAt: a.createdAt,
      seenAt: a.seenAt,
      ...(cifras ? { used: a.used, limit: a.limit } : {}),
    });
  }
  return out;
}

export async function getOwnerUsage(organizationId: string, now = new Date()): Promise<OwnerUsage> {
  // Una tras otra: son pocas lecturas pequeñas y así un fallo no deja
  // promesas sin manejar.
  const detail = await readOrgUsageDetail(organizationId, now);
  const limits = await getEffectiveLimits(organizationId);
  const visibility = limits.usageVisibility;
  const embedTokens = await embedTokensUsed(organizationId, now);
  // Solo los dos números de este contrato (037 PR 3 agregó `exclusive` al uso de Documentos).
  const kb = (await orgHasKbDocs(organizationId)) ? await getKbDocUsage(organizationId) : null;
  const documents = kb ? { documents: kb.documents, chunks: kb.chunks } : null;
  const members = await countMembers(organizationId);
  const orgModules = await getOrgModules(organizationId);
  const modules = countActiveModules(moduleToggles(orgModules));
  const assistant = orgModules.asistente
    ? projectGauge(visibility, await assistantTokensUsed(organizationId, now), limits.assistantTokens.value)
    : null;
  const alerts = await listOwnerAlerts(organizationId, { now, visibility });

  const { ai } = detail;
  const porTokens = projectGauge(visibility, ai.tokens, limits.aiTokens.value);
  const porTurnos = projectGauge(visibility, ai.turns, limits.aiTurns.value);
  const total: OwnerAiTotal = {
    ...worstGauge(porTokens, porTurnos),
    ...(visibility === "tokens"
      ? { tokens: { used: ai.tokens, limit: limits.aiTokens.value }, turns: { used: ai.turns, limit: limits.aiTurns.value } }
      : {}),
  };
  // Lo de `worstGauge` en `tokens` trae `used`/`limit` de una sola medida: van aparte.
  delete total.used;
  delete total.limit;

  const funciones = (Object.entries(ai.byKind) as [AiUsageKind, { turns: number; tokens: number }][])
    .filter(([k]) => k !== "embed")
    .map(([key, v]) => ({ key, tokens: v.tokens, turns: v.turns }));
  const agentes = projectShares(visibility, ai.byAgent.map((a) => ({ key: a.agentId, tokens: a.tokens, turns: a.turns })));
  const porAgente = new Map(ai.byAgent.map((a) => [a.agentId, a]));

  const { aiTurns: _t, aiTokens: _k, embedTokens: _e, assistantTokens: _a, ...ownerLimits } = limits;

  return {
    period: detail.period,
    visibility,
    ai: {
      total,
      embed: projectGauge(visibility, embedTokens, limits.embedTokens.value),
      assistant,
      byKind: projectShares(visibility, funciones),
      byAgent:
        agentes?.map((line) => ({
          ...line,
          name: porAgente.get(line.key)?.name ?? null,
          archived: porAgente.get(line.key)?.archived ?? true,
        })) ?? null,
    },
    storage: detail.storage,
    limits: ownerLimits,
    documents,
    members,
    modules,
    alerts,
  };
}
