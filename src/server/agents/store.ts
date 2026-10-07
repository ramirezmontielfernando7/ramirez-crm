import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { getDb, schema, withTenant } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  agentConfigSchema,
  emptyConfig,
  mirrorFields,
  parseStoredConfig,
  sameConfig,
  type AgentConfig,
} from "./config";
import { ensureGeneralAgent, type AgentRow } from "./ensure";
import { copyAgentKb } from "./kb";
import { appendPublishLog, type PublishAction } from "./log";
import { syncGeneralToProfile } from "./mirror";
import { removeAgentStages } from "./assignments";

/**
 * 031 — ÚNICA puerta de `agent` y `agent_publish_log` (con `ensure.ts`,
 * `mirror.ts` y `log.ts`). Todo con la BD de la organización (RLS); lo que
 * escribe más de una fila va en UNA transacción (`withTenant`). Nunca se
 * llama al modelo desde aquí.
 */

/** D6 — Agentes activos (no archivados) por organización. */
export const MAX_ACTIVE_AGENTS = 20;

export type AgentErrorCode = "agent_limit" | "agent_general" | "not_published" | "not_found";

export class AgentError extends Error {
  constructor(readonly code: AgentErrorCode, message: string) {
    super(message);
    this.name = "AgentError";
  }
}

export type AgentStatus = "published" | "draft" | "changes";

export type AgentSummary = {
  id: string;
  internalName: string;
  displayName: string | null;
  isGeneral: boolean;
  status: AgentStatus;
  publishedAt: string | null;
  lastRun: { score: number | null; at: string } | null;
  createdAt: string;
};

export type AgentDetail = {
  id: string;
  internalName: string;
  isGeneral: boolean;
  draft: AgentConfig;
  published: AgentConfig | null;
  publishedAt: string | null;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
};

function statusOf(draft: AgentConfig | null, published: AgentConfig | null): AgentStatus {
  if (!published) return "draft";
  return draft && !sameConfig(draft, published) ? "changes" : "published";
}

function toDetail(row: AgentRow): AgentDetail {
  const draft = parseStoredConfig(row.draft) ?? emptyConfig();
  const published = parseStoredConfig(row.published);
  return {
    id: row.id,
    internalName: row.internalName,
    isGeneral: row.isGeneral,
    draft,
    published,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    status: statusOf(draft, published),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Un agente por id, no archivado (va dentro de `scoped`). */
const activeId = (id: string) => and(eq(schema.agent.id, id), isNull(schema.agent.archivedAt));

async function lockAgent(tx: Db, organizationId: string, id: string): Promise<AgentRow> {
  const [row] = await tx.select().from(schema.agent).where(scoped(schema.agent.organizationId, organizationId, activeId(id))).limit(1).for("update");
  if (!row) throw new AgentError("not_found", "Agente no encontrado");
  return row;
}

/** Lista de agentes activos (el general primero) con su última evaluación. */
export async function listAgents(organizationId: string): Promise<AgentSummary[]> {
  await ensureGeneralAgent(organizationId);
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.agent)
    .where(scoped(schema.agent.organizationId, organizationId, isNull(schema.agent.archivedAt)))
    .orderBy(desc(schema.agent.isGeneral), asc(schema.agent.createdAt));
  const ids = rows.map((r) => r.id);
  const runs = ids.length
    ? await db
        .select({
          agentId: schema.agentTestRun.agentId,
          score: schema.agentTestRun.score,
          finishedAt: schema.agentTestRun.finishedAt,
        })
        .from(schema.agentTestRun)
        .where(
          scoped(
            schema.agentTestRun.organizationId,
            organizationId,
            and(eq(schema.agentTestRun.status, "done"), inArray(schema.agentTestRun.agentId, ids))
          )
        )
        .orderBy(desc(schema.agentTestRun.startedAt))
    : [];
  const lastRun = new Map<string, { score: number | null; at: string }>();
  for (const r of runs) {
    if (r.agentId && !lastRun.has(r.agentId)) {
      lastRun.set(r.agentId, { score: r.score, at: (r.finishedAt ?? new Date()).toISOString() });
    }
  }
  return rows.map((row) => {
    const d = toDetail(row);
    return {
      id: d.id,
      internalName: d.internalName,
      displayName: (d.published ?? d.draft).displayName,
      isGeneral: d.isGeneral,
      status: d.status,
      publishedAt: d.publishedAt,
      lastRun: lastRun.get(d.id) ?? null,
      createdAt: d.createdAt,
    };
  });
}

export async function getAgent(organizationId: string, id: string): Promise<AgentDetail | null> {
  const [row] = await getDb().select().from(schema.agent).where(scoped(schema.agent.organizationId, organizationId, activeId(id))).limit(1);
  return row ? toDetail(row) : null;
}

/**
 * Crea un agente en BORRADOR (sin nombre de presentación, D9) o duplica
 * otro (su borrador y su conocimiento propio). Tope de 20 activos, con un
 * candado por organización para que dos altas a la vez no lo rebasen.
 */
export async function createAgent(input: {
  organizationId: string;
  actorUserId: string;
  internalName: string;
  duplicateOf?: string;
}): Promise<AgentDetail> {
  const { organizationId } = input;
  await ensureGeneralAgent(organizationId);
  return withTenant(organizationId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`agent:${organizationId}`}))`);
    const [{ n } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(schema.agent)
      .where(scoped(schema.agent.organizationId, organizationId, isNull(schema.agent.archivedAt)));
    if (n >= MAX_ACTIVE_AGENTS) {
      throw new AgentError("agent_limit", `Llegaste al máximo de ${MAX_ACTIVE_AGENTS} agentes activos`);
    }
    let draft = emptyConfig();
    if (input.duplicateOf) {
      const [src] = await tx.select().from(schema.agent).where(scoped(schema.agent.organizationId, organizationId, activeId(input.duplicateOf))).limit(1);
      if (!src) throw new AgentError("not_found", "El agente a duplicar no existe");
      draft = parseStoredConfig(src.draft) ?? emptyConfig();
    }
    const id = newId("agent");
    const [row] = await tx
      .insert(schema.agent)
      .values({
        id,
        organizationId,
        internalName: input.internalName,
        isGeneral: false,
        draft,
        createdBy: input.actorUserId,
      })
      .returning();
    if (input.duplicateOf) await copyAgentKb(organizationId, input.duplicateOf, id, tx);
    return toDetail(row!);
  });
}

export async function renameAgent(organizationId: string, id: string, internalName: string): Promise<AgentDetail> {
  const [row] = await getDb()
    .update(schema.agent)
    .set({ internalName, updatedAt: new Date() })
    .where(scoped(schema.agent.organizationId, organizationId, activeId(id)))
    .returning();
  if (!row) throw new AgentError("not_found", "Agente no encontrado");
  return toDetail(row);
}

/** Archivar (borrado suave). El general no se archiva. */
export async function archiveAgent(organizationId: string, id: string): Promise<void> {
  await withTenant(organizationId, async (tx) => {
    const row = await lockAgent(tx, organizationId, id);
    if (row.isGeneral) {
      throw new AgentError("agent_general", "El agente general no se puede archivar; haz general a otro primero");
    }
    await tx
      .update(schema.agent)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(scoped(schema.agent.organizationId, organizationId, activeId(id)));
  });
}

/** Guarda el BORRADOR. Nunca cambia lo que atiende en producción. */
export async function saveDraft(organizationId: string, id: string, config: AgentConfig): Promise<AgentDetail> {
  const draft = agentConfigSchema.parse(config) as AgentConfig;
  const [row] = await getDb()
    .update(schema.agent)
    .set({ draft, updatedAt: new Date() })
    .where(scoped(schema.agent.organizationId, organizationId, activeId(id)))
    .returning();
  if (!row) throw new AgentError("not_found", "Agente no encontrado");
  return toDetail(row);
}

async function publishInTx(
  tx: Db,
  organizationId: string,
  row: AgentRow,
  config: AgentConfig,
  actorUserId: string | null,
  action: PublishAction
): Promise<AgentRow> {
  const now = new Date();
  const [updated] = await tx
    .update(schema.agent)
    .set({ draft: config, published: config, publishedAt: now, publishedBy: actorUserId, updatedAt: now })
    .where(scoped(schema.agent.organizationId, organizationId, activeId(row.id)))
    .returning();
  await appendPublishLog(tx, { organizationId, agentId: row.id, action, snapshot: config, actorUserId, at: now });
  // El general publicado se refleja en `agent_profile`, con la misma hora.
  if (row.isGeneral) await syncGeneralToProfile(tx, organizationId, config, now);
  return updated!;
}

/**
 * Publica el borrador: pasa a producción, queda en el historial y, si es el
 * general, en el espejo `agent_profile`. Todo en una transacción.
 */
export async function publishAgent(organizationId: string, id: string, actorUserId: string): Promise<AgentDetail> {
  const row = await withTenant(organizationId, async (tx) => {
    const current = await lockAgent(tx, organizationId, id);
    const draft = parseStoredConfig(current.draft) ?? emptyConfig();
    return publishInTx(tx, organizationId, current, draft, actorUserId, "publish");
  });
  return toDetail(row);
}

/**
 * Hace general a un agente PUBLICADO. Primero se degrada al general actual y
 * luego se promueve este (el índice único parcial no es diferible): en
 * ningún momento visible hay 0 ni 2 generales.
 */
export async function makeGeneral(organizationId: string, id: string, actorUserId: string): Promise<AgentDetail> {
  await ensureGeneralAgent(organizationId);
  const row = await withTenant(organizationId, async (tx) => {
    const target = await lockAgent(tx, organizationId, id);
    const published = parseStoredConfig(target.published);
    if (!published) throw new AgentError("not_published", "Publica este agente antes de hacerlo general");
    if (target.isGeneral) return target;
    const now = new Date();
    await tx
      .update(schema.agent)
      .set({ isGeneral: false, updatedAt: now })
      .where(
        scoped(schema.agent.organizationId, organizationId, and(eq(schema.agent.isGeneral, true), isNull(schema.agent.archivedAt)))
      );
    const [promoted] = await tx
      .update(schema.agent)
      .set({ isGeneral: true, updatedAt: now })
      .where(scoped(schema.agent.organizationId, organizationId, activeId(id)))
      .returning();
    // PR B: el general atiende todo lo que no tiene agente propio; no tiene etapas.
    await removeAgentStages(tx, organizationId, id);
    await appendPublishLog(tx, { organizationId, agentId: id, action: "make_general", snapshot: published, actorUserId, at: now });
    await syncGeneralToProfile(tx, organizationId, published, now);
    return promoted!;
  });
  return toDetail(row);
}

export type AgentVersion = {
  id: string;
  action: PublishAction;
  snapshot: AgentConfig;
  actorName: string | null;
  at: string;
};

export async function listVersions(organizationId: string, id: string): Promise<AgentVersion[] | null> {
  if (!(await getAgent(organizationId, id))) return null;
  const rows = await getDb()
    .select({
      id: schema.agentPublishLog.id,
      action: schema.agentPublishLog.action,
      snapshot: schema.agentPublishLog.snapshot,
      at: schema.agentPublishLog.at,
      actorName: schema.user.name,
    })
    .from(schema.agentPublishLog)
    .leftJoin(schema.user, eq(schema.user.id, schema.agentPublishLog.actorUserId))
    .where(scoped(schema.agentPublishLog.organizationId, organizationId, eq(schema.agentPublishLog.agentId, id)))
    .orderBy(desc(schema.agentPublishLog.at), desc(schema.agentPublishLog.id));
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    snapshot: parseStoredConfig(r.snapshot) ?? emptyConfig(),
    actorName: r.actorName ?? null,
    at: r.at.toISOString(),
  }));
}

/** D8 — Restaurar una versión la carga al BORRADOR, nunca a producción. */
export async function restoreVersion(
  organizationId: string,
  id: string,
  logId: string,
  actorUserId: string
): Promise<AgentDetail> {
  const row = await withTenant(organizationId, async (tx) => {
    await lockAgent(tx, organizationId, id);
    const [version] = await tx
      .select({ snapshot: schema.agentPublishLog.snapshot })
      .from(schema.agentPublishLog)
      .where(
        scoped(
          schema.agentPublishLog.organizationId,
          organizationId,
          and(eq(schema.agentPublishLog.agentId, id), eq(schema.agentPublishLog.id, logId))
        )
      )
      .limit(1);
    const snapshot = parseStoredConfig(version?.snapshot);
    if (!snapshot) throw new AgentError("not_found", "Versión no encontrada");
    const [updated] = await tx
      .update(schema.agent)
      .set({ draft: snapshot, updatedAt: new Date() })
      .where(scoped(schema.agent.organizationId, organizationId, activeId(id)))
      .returning();
    await appendPublishLog(tx, { organizationId, agentId: id, action: "restore", snapshot, actorUserId });
    return updated!;
  });
  return toDetail(row);
}

/* ------------------------------------------------------------------------
 * `/api/agent/profile` (histórico). `/agent` edita al GENERAL con el mismo
 * contrato de siempre: guardar = publicar, como antes de 031.
 * --------------------------------------------------------------------- */

export type LegacyProfile = {
  enabled: boolean;
  name: string;
  displayName: string | null;
  tone: string | null;
  instructions: string | null;
  escalationRules: string | null;
  greeting: string | null;
  generalAgentId: string;
  hasUnpublishedDraft: boolean;
};

export async function getLegacyProfile(organizationId: string): Promise<LegacyProfile | null> {
  const general = await ensureGeneralAgent(organizationId);
  if (!general?.published) return null;
  const p = general.published;
  const draft = parseStoredConfig(general.agent.draft);
  return {
    enabled: general.enabled,
    name: mirrorFields(p).name,
    displayName: p.displayName,
    tone: p.tone,
    instructions: p.instructions,
    escalationRules: p.escalationRules,
    greeting: p.greeting,
    generalAgentId: general.agent.id,
    hasUnpublishedDraft: !!draft && !sameConfig(draft, p),
  };
}

export type LegacyPatch = {
  enabled?: boolean;
  name?: string | null;
  tone?: string | null;
  instructions?: string | null;
  escalationRules?: string | null;
  greeting?: string | null;
};

/**
 * PUT histórico. Solo `enabled` → el interruptor, igual que siempre. Con
 * comportamiento → `agent_profile` Y el general (borrador + publicado) en
 * una transacción, anotado como `legacy_put`. `name: null` = sin nombre.
 */
export async function putLegacyProfile(
  organizationId: string,
  actorUserId: string,
  patch: LegacyPatch
): Promise<boolean> {
  const touchesBehavior = (["name", "tone", "instructions", "escalationRules", "greeting"] as const).some(
    (k) => patch[k] !== undefined
  );
  if (!touchesBehavior) {
    const rows = await getDb()
      .update(schema.agentProfile)
      .set({ ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}), updatedAt: new Date() })
      .where(scoped(schema.agentProfile.organizationId, organizationId))
      .returning({ id: schema.agentProfile.id });
    return rows.length > 0;
  }
  const general = await ensureGeneralAgent(organizationId);
  if (!general) return false;
  await withTenant(organizationId, async (tx) => {
    const row = await lockAgent(tx, organizationId, general.agent.id);
    const base = parseStoredConfig(row.published) ?? emptyConfig();
    const next = agentConfigSchema.parse({
      ...base,
      ...(patch.name !== undefined ? { displayName: patch.name } : {}),
      ...(patch.tone !== undefined ? { tone: patch.tone } : {}),
      ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}),
      ...(patch.escalationRules !== undefined ? { escalationRules: patch.escalationRules } : {}),
      ...(patch.greeting !== undefined ? { greeting: patch.greeting } : {}),
      useSharedKb: true,
    }) as AgentConfig;
    await publishInTx(tx, organizationId, row, next, actorUserId, "legacy_put");
    if (patch.enabled !== undefined) {
      await tx
        .update(schema.agentProfile)
        .set({ enabled: patch.enabled })
        .where(scoped(schema.agentProfile.organizationId, organizationId));
    }
  });
  return true;
}
