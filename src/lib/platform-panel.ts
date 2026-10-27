import { aiMeter, storageMeter, type Meter } from "@/lib/usage";

/**
 * 036 (PR 5) — «Mi panel» de Plataforma: el resumen de un vistazo (puro, sin
 * React). Solo metadatos y números: organizaciones por estado, IA del mes
 * contra lo asignado, almacenamiento aproximado, quién está cerca de un tope y
 * quién consume más. Se arma con las mismas filas de «Organizaciones».
 */
type PanelOrg = {
  id: string;
  name: string;
  status: "active" | "suspended" | "deleted";
  usage: {
    ai: { turns: number; tokens: number; limits: { turns: number | null; tokens: number | null } };
    storageBytes: number;
    plan: { storageLimitBytes: number | null };
    alerts: { metric: string; threshold: number }[];
  } | null;
};

export type PanelNearLimit = { id: string; name: string; meter: Meter; kind: "ia" | "almacenamiento" };
export type PanelTop = { id: string; name: string; tokens: number; turns: number };

export type PanelSummary = {
  byStatus: { active: number; suspended: number; deleted: number };
  /** Solo organizaciones activas: son las que consumen. */
  ai: { tokens: number; turns: number; assignedTokens: number | null; assignedTurns: number | null; withoutLimit: number };
  storageBytes: number;
  nearLimit: PanelNearLimit[];
  topAi: PanelTop[];
};

export function buildPanel(orgs: readonly PanelOrg[], topN = 5): PanelSummary {
  const byStatus = { active: 0, suspended: 0, deleted: 0 };
  const active = orgs.filter((o) => o.status === "active");
  for (const o of orgs) byStatus[o.status] += 1;

  let tokens = 0;
  let turns = 0;
  let storageBytes = 0;
  let assignedTokens = 0;
  let assignedTurns = 0;
  let anyTokenLimit = false;
  let anyTurnLimit = false;
  let withoutLimit = 0;
  const near: PanelNearLimit[] = [];

  for (const o of active) {
    const u = o.usage;
    if (!u) continue;
    tokens += u.ai.tokens;
    turns += u.ai.turns;
    storageBytes += u.storageBytes;
    if (u.ai.limits.tokens !== null) {
      assignedTokens += u.ai.limits.tokens;
      anyTokenLimit = true;
    }
    if (u.ai.limits.turns !== null) {
      assignedTurns += u.ai.limits.turns;
      anyTurnLimit = true;
    }
    if (u.ai.limits.tokens === null && u.ai.limits.turns === null) withoutLimit += 1;
    const ia = aiMeter(u.ai, u.ai.limits);
    if (ia.ratio !== null && ia.ratio >= 0.8) near.push({ id: o.id, name: o.name, meter: ia, kind: "ia" });
    const st = storageMeter(u.storageBytes, u.plan.storageLimitBytes);
    if (st.ratio !== null && st.ratio >= 0.8) near.push({ id: o.id, name: o.name, meter: st, kind: "almacenamiento" });
  }

  near.sort((a, b) => (b.meter.ratio ?? 0) - (a.meter.ratio ?? 0));
  const topAi = active
    .filter((o) => o.usage && o.usage.ai.tokens > 0)
    .map((o) => ({ id: o.id, name: o.name, tokens: o.usage!.ai.tokens, turns: o.usage!.ai.turns }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, topN);

  return {
    byStatus,
    ai: {
      tokens,
      turns,
      assignedTokens: anyTokenLimit ? assignedTokens : null,
      assignedTurns: anyTurnLimit ? assignedTurns : null,
      withoutLimit,
    },
    storageBytes,
    nearLimit: near,
    topAi,
  };
}
