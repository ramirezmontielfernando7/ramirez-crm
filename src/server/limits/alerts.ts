import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { logger } from "@/lib/log";
import { crossedThresholds, type AlertMetric, type AlertThreshold } from "@/lib/limits";
import { currentPeriod } from "@/server/ai-quota/quota";
import { countActiveModules } from "@/lib/platform-modules";
import { getOrgModules } from "@/server/modules";
import { getOrgStorageUsage } from "@/server/usage/storage";
import { countMembers, getEffectiveLimits, moduleToggles } from "./index";

/**
 * 036 (PR 3a) — Avisos de consumo al 80 % y al 100 % de cada tope. Uno por
 * (organización, mes UTC, medida, umbral): `usage_alert` con llave primaria,
 * así que revisar dos veces no avisa dos veces. Los ve el Propietario dentro
 * de la app (permiso `usage.read`) y el administrador de plataforma en la
 * fila de la organización. Nunca correo (constitución II).
 *
 * Se revisa donde crece cada medida: al contar un turno de IA, al embeber, al
 * subir un archivo, al agregar una persona, al cambiar módulos o topes, y en
 * el trabajo diario (la multimedia de WhatsApp crece sola). Un fallo al
 * revisar se registra y nunca tumba lo que lo llamó.
 *
 * Todo a nombre de la organización (pool de la app, RLS).
 */

const log = logger("limits");

export type UsageAlertDto = {
  metric: AlertMetric;
  threshold: AlertThreshold;
  used: number;
  limit: number;
  period: string;
  createdAt: string;
  seenAt: string | null;
};

/** Anota los umbrales cruzados que aún no tenían aviso este mes. Devuelve los nuevos. */
export async function recordCrossings(
  organizationId: string,
  metric: AlertMetric,
  used: number,
  limit: number | null,
  now = new Date()
): Promise<AlertThreshold[]> {
  const cruzados = crossedThresholds(used, limit);
  if (cruzados.length === 0 || limit === null) return [];
  const period = currentPeriod(now);
  const nuevos = await getDb()
    .insert(schema.usageAlert)
    .values(cruzados.map((threshold) => ({ organizationId, period, metric, threshold, used, limitValue: limit })))
    .onConflictDoNothing()
    .returning({ threshold: schema.usageAlert.threshold });
  const out = nuevos.map((n) => n.threshold as AlertThreshold);
  if (out.length > 0) log.info("aviso de consumo", { org: organizationId, medida: metric, umbrales: out.join(",") });
  return out;
}

/** Corre una revisión sin dejar que un fallo suba (se registra). */
async function seguro(nombre: string, organizationId: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log.error(`no se pudo revisar el aviso de ${nombre}`, { org: organizationId, err });
  }
}

/** IA del mes (tokens y turnos), contra la fila `total` de `ai_usage`. */
export async function checkAiAlerts(organizationId: string, now = new Date()): Promise<void> {
  await seguro("IA", organizationId, async () => {
    const [limits, [row]] = await Promise.all([
      getEffectiveLimits(organizationId),
      getDb()
        .select({ turns: schema.aiUsage.turns, p: schema.aiUsage.promptTokens, c: schema.aiUsage.completionTokens })
        .from(schema.aiUsage)
        .where(
          scoped(
            schema.aiUsage.organizationId,
            organizationId,
            eq(schema.aiUsage.period, currentPeriod(now)),
            eq(schema.aiUsage.kind, "total")
          )
        )
        .limit(1),
    ]);
    if (!row) return;
    await recordCrossings(organizationId, "ai_tokens", row.p + row.c, limits.aiTokens.value, now);
    await recordCrossings(organizationId, "ai_turns", row.turns, limits.aiTurns.value, now);
  });
}

/** Tokens de embeddings del mes. */
export async function checkEmbedAlerts(organizationId: string, now = new Date()): Promise<void> {
  await seguro("embeddings", organizationId, async () => {
    const [limits, [row]] = await Promise.all([
      getEffectiveLimits(organizationId),
      getDb()
        .select({ t: schema.aiUsage.promptTokens })
        .from(schema.aiUsage)
        .where(
          scoped(
            schema.aiUsage.organizationId,
            organizationId,
            eq(schema.aiUsage.period, currentPeriod(now)),
            eq(schema.aiUsage.kind, "embed")
          )
        )
        .limit(1),
    ]);
    if (!row) return;
    await recordCrossings(organizationId, "embed_tokens", row.t, limits.embedTokens.value, now);
  });
}

/** Almacenamiento aproximado. */
export async function checkStorageAlerts(organizationId: string, now = new Date()): Promise<void> {
  await seguro("almacenamiento", organizationId, async () => {
    const limits = await getEffectiveLimits(organizationId);
    if (limits.storageBytes.value === null) return;
    const usage = await getOrgStorageUsage(organizationId);
    await recordCrossings(organizationId, "storage", usage.totalBytes, limits.storageBytes.value, now);
  });
}

/** Personas del equipo. */
export async function checkMemberAlerts(organizationId: string, now = new Date()): Promise<void> {
  await seguro("personas", organizationId, async () => {
    const limits = await getEffectiveLimits(organizationId);
    if (limits.members.value === null) return;
    await recordCrossings(organizationId, "members", await countMembers(organizationId), limits.members.value, now);
  });
}

/** Módulos activos (de los 12 de /platform). */
export async function checkModuleAlerts(organizationId: string, now = new Date()): Promise<void> {
  await seguro("módulos", organizationId, async () => {
    const limits = await getEffectiveLimits(organizationId);
    if (limits.modules.value === null) return;
    const activos = countActiveModules(moduleToggles(await getOrgModules(organizationId))).active;
    await recordCrossings(organizationId, "modules", activos, limits.modules.value, now);
  });
}

/** Todas las medidas (al cambiar topes y en el trabajo diario). */
export async function checkAllAlerts(organizationId: string, now = new Date()): Promise<void> {
  await checkAiAlerts(organizationId, now);
  await checkEmbedAlerts(organizationId, now);
  await checkStorageAlerts(organizationId, now);
  await checkMemberAlerts(organizationId, now);
  await checkModuleAlerts(organizationId, now);
}

function toDto(r: typeof schema.usageAlert.$inferSelect): UsageAlertDto {
  return {
    metric: r.metric,
    threshold: r.threshold as AlertThreshold,
    used: r.used,
    limit: r.limitValue,
    period: r.period,
    createdAt: r.createdAt.toISOString(),
    seenAt: r.seenAt?.toISOString() ?? null,
  };
}

/**
 * Los avisos del mes. `onlyUnseen`: los que el Propietario no ha marcado como
 * vistos (para el aviso de la app). Si una medida cruzó el 100 %, su aviso
 * del 80 % sobra: se devuelve solo el más alto.
 */
export async function listAlerts(
  organizationId: string,
  opts: { onlyUnseen?: boolean; now?: Date } = {}
): Promise<UsageAlertDto[]> {
  const rows = await getDb()
    .select()
    .from(schema.usageAlert)
    .where(
      scoped(
        schema.usageAlert.organizationId,
        organizationId,
        eq(schema.usageAlert.period, currentPeriod(opts.now)),
        opts.onlyUnseen ? isNull(schema.usageAlert.seenAt) : undefined
      )
    )
    .orderBy(desc(schema.usageAlert.threshold), desc(schema.usageAlert.createdAt));
  const porMedida = new Map<string, UsageAlertDto>();
  for (const r of rows) if (!porMedida.has(r.metric)) porMedida.set(r.metric, toDto(r));
  return [...porMedida.values()];
}

/** El Propietario marca como vistos los avisos del mes. */
export async function markAlertsSeen(organizationId: string, userId: string, now = new Date()): Promise<number> {
  const r = await getDb()
    .update(schema.usageAlert)
    .set({ seenAt: now, seenBy: userId })
    .where(
      scoped(
        schema.usageAlert.organizationId,
        organizationId,
        and(eq(schema.usageAlert.period, currentPeriod(now)), isNull(schema.usageAlert.seenAt))
      )
    )
    .returning({ metric: schema.usageAlert.metric });
  return r.length;
}
