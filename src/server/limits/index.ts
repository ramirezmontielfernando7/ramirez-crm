import { count } from "drizzle-orm";
import { getDb, schema, withTenant, type Db } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import {
  LIMIT_MESSAGES,
  resolveLimit,
  type EffectiveLimits,
  type LimitsPatch,
  type StorageMode,
} from "@/lib/limits";
import { countActiveModules, type PlatformModuleToggle } from "@/lib/platform-modules";
import { envKbDocLimits, getOwnKbDocLimits } from "@/server/kb-docs/limits";
import { saveKbDocLimits } from "@/server/kb-docs/store";
import type { OrgModules } from "@/server/modules";
import { getOrgStorageUsage } from "@/server/usage/storage";

/**
 * 036 (PR 3a) — La puerta de los LÍMITES de una organización: qué topes
 * valen (propios, del entorno o ninguno), guardarlos y comprobarlos antes de
 * crecer. Cada tope vive donde ya vivía:
 *
 * - IA (turnos y tokens): `ai_quota` (lo sigue leyendo `reserveTurn`).
 * - Documentos del agente: `kb_document_limit` (lo sigue leyendo kb-docs).
 * - Personas, almacenamiento (y su modo), módulos activos y embeddings:
 *   `organization_plan` (nuevo).
 *
 * Así `scripts/ai-quota.mjs` y `scripts/kb-limits.mjs` siguen funcionando.
 * Bajar un tope por debajo del uso NO quita nada: solo impide crecer.
 * Todo a nombre de la organización (pool de la app, RLS).
 */

export class LimitError extends Error {
  constructor(
    readonly status: number,
    readonly code: "storage_limit" | "member_limit" | "module_limit",
    message: string
  ) {
    super(message);
    this.name = "LimitError";
  }
}

type PlanRow = typeof schema.organizationPlan.$inferSelect;

async function planRow(organizationId: string, db: Db = getDb()): Promise<PlanRow | null> {
  const [row] = await db
    .select()
    .from(schema.organizationPlan)
    .where(scoped(schema.organizationPlan.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

/** Los topes que valen hoy para la organización, cada uno con su origen. */
export async function getEffectiveLimits(organizationId: string, db: Db = getDb()): Promise<EffectiveLimits> {
  const env = getEnv();
  const kbEnv = envKbDocLimits();
  const [plan, [quota], kb] = await Promise.all([
    planRow(organizationId, db),
    db
      .select({ turns: schema.aiQuota.monthlyTurnLimit, tokens: schema.aiQuota.monthlyTokenLimit })
      .from(schema.aiQuota)
      .where(scoped(schema.aiQuota.organizationId, organizationId))
      .limit(1),
    getOwnKbDocLimits(organizationId, db),
  ]);
  return {
    planKey: "custom",
    aiTurns: resolveLimit(quota?.turns, env.AI_DEFAULT_MONTHLY_TURNS),
    aiTokens: resolveLimit(quota?.tokens, env.AI_DEFAULT_MONTHLY_TOKENS),
    embedTokens: resolveLimit(plan?.embedTokenLimit, env.AI_DEFAULT_MONTHLY_EMBED_TOKENS),
    // Personas, almacenamiento y módulos no tienen valor de entorno: sin tope propio, sin tope.
    members: resolveLimit(plan?.maxMembers, null),
    storageBytes: resolveLimit(plan?.storageLimitBytes, null),
    storageMode: (plan?.storageMode ?? "warn") as StorageMode,
    modules: resolveLimit(plan?.maxActiveModules, null),
    kbMaxDocuments: resolveLimit(kb.maxDocuments, kbEnv.maxDocuments),
    kbMaxChunks: resolveLimit(kb.maxChunks, kbEnv.maxChunks),
    kbMaxFileBytes: resolveLimit(kb.maxFileBytes, kbEnv.maxFileBytes),
  };
}

/** El tope de tokens de embeddings del mes (propio o del entorno), o `null` sin tope. */
export async function getEmbedTokenLimit(organizationId: string): Promise<number | null> {
  const plan = await planRow(organizationId);
  return plan?.embedTokenLimit ?? getEnv().AI_DEFAULT_MONTHLY_EMBED_TOKENS ?? null;
}

/**
 * Guarda los topes (solo el administrador de plataforma, que la llama desde
 * `src/server/platform-admin/`). Todo en UNA transacción a nombre de la
 * organización. Devuelve el antes y el después para la bitácora.
 */
export async function saveOrgLimits(
  organizationId: string,
  patch: LimitsPatch,
  actorUserId: string | null
): Promise<{ before: EffectiveLimits; after: EffectiveLimits }> {
  const before = await withTenant(organizationId, (tx) => getEffectiveLimits(organizationId, tx));
  await withTenant(organizationId, async (tx) => {
    if (patch.aiTurns !== undefined || patch.aiTokens !== undefined) {
      const [q] = await tx
        .select()
        .from(schema.aiQuota)
        .where(scoped(schema.aiQuota.organizationId, organizationId))
        .limit(1);
      const values = {
        monthlyTurnLimit: patch.aiTurns === undefined ? (q?.monthlyTurnLimit ?? null) : patch.aiTurns,
        monthlyTokenLimit: patch.aiTokens === undefined ? (q?.monthlyTokenLimit ?? null) : patch.aiTokens,
        updatedAt: new Date(),
      };
      await tx
        .insert(schema.aiQuota)
        .values({ organizationId, ...values })
        .onConflictDoUpdate({ target: schema.aiQuota.organizationId, set: values });
    }

    const tocaPlan = (["planKey", "members", "storageBytes", "storageMode", "modules", "embedTokens"] as const).some(
      (k) => patch[k] !== undefined
    );
    if (tocaPlan) {
      const actual = await planRow(organizationId, tx);
      const values = {
        planKey: patch.planKey ?? actual?.planKey ?? "custom",
        maxMembers: patch.members === undefined ? (actual?.maxMembers ?? null) : patch.members,
        storageLimitBytes: patch.storageBytes === undefined ? (actual?.storageLimitBytes ?? null) : patch.storageBytes,
        storageMode: patch.storageMode ?? actual?.storageMode ?? "warn",
        maxActiveModules: patch.modules === undefined ? (actual?.maxActiveModules ?? null) : patch.modules,
        embedTokenLimit: patch.embedTokens === undefined ? (actual?.embedTokenLimit ?? null) : patch.embedTokens,
        updatedAt: new Date(),
        updatedBy: actorUserId,
      };
      await tx
        .insert(schema.organizationPlan)
        .values({ organizationId, ...values })
        .onConflictDoUpdate({ target: schema.organizationPlan.organizationId, set: values });
    }

    await saveKbDocLimits(tx, organizationId, {
      maxFileBytes: patch.kbMaxFileBytes,
      maxDocuments: patch.kbMaxDocuments,
      maxChunks: patch.kbMaxChunks,
    });
  });
  const after = await withTenant(organizationId, (tx) => getEffectiveLimits(organizationId, tx));
  return { before, after };
}

/* ───────── Comprobaciones antes de crecer ───────── */

/**
 * Almacenamiento en modo «Bloquear subidas manuales»: rechaza la subida que
 * PASARÍA el tope (uso actual + este archivo). La llaman SOLO las subidas
 * hechas desde el CRM (documentos del agente, Conocimientos, chat de
 * equipo); la multimedia entrante de WhatsApp se guarda siempre.
 */
export async function assertCanUpload(organizationId: string, bytes: number): Promise<void> {
  const plan = await planRow(organizationId);
  if (!plan || plan.storageMode !== "block_uploads" || plan.storageLimitBytes === null) return;
  const usage = await getOrgStorageUsage(organizationId);
  if (usage.totalBytes + Math.max(0, bytes) > plan.storageLimitBytes) {
    throw new LimitError(413, "storage_limit", LIMIT_MESSAGES.storage);
  }
}

/** Cuántas personas tiene la organización. */
export async function countMembers(organizationId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(schema.member)
    .where(scoped(schema.member.organizationId, organizationId));
  return Number(row?.n ?? 0);
}

/** Antes de dar de alta a una persona: ¿cabe en su tope? */
export async function assertCanAddMember(organizationId: string): Promise<void> {
  const plan = await planRow(organizationId);
  if (plan?.maxMembers === null || plan?.maxMembers === undefined) return;
  if ((await countMembers(organizationId)) >= plan.maxMembers) {
    throw new LimitError(409, "member_limit", LIMIT_MESSAGES.members);
  }
}

/** Los 12 interruptores de /platform a partir de los módulos de la organización. */
export function moduleToggles(m: OrgModules): Record<PlatformModuleToggle, boolean> {
  return {
    teamChat: m.teamChat,
    knowledge: m.knowledge,
    results: m.results,
    agent: m.agent,
    lab: m.lab,
    campaigns: m.campaigns,
    agenda: m.agenda,
    trabajo: m.trabajo,
    atribucion: m.atribucion,
    instagram: m.channels.has("instagram"),
    messenger: m.channels.has("messenger"),
    customNav: m.customNav,
  };
}

/**
 * Antes de cambiar módulos: si el cambio ENCIENDE más de los que permite el
 * tope, se rechaza. Apagar siempre se puede (aunque siga por encima).
 */
export async function assertModulesWithinLimit(
  organizationId: string,
  current: Record<PlatformModuleToggle, boolean>,
  next: Record<PlatformModuleToggle, boolean>
): Promise<void> {
  const plan = await planRow(organizationId);
  if (plan?.maxActiveModules === null || plan?.maxActiveModules === undefined) return;
  const antes = countActiveModules(current).active;
  const despues = countActiveModules(next).active;
  if (despues > antes && despues > plan.maxActiveModules) {
    throw new LimitError(422, "module_limit", LIMIT_MESSAGES.modules);
  }
}
