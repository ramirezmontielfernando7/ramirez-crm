import { asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { DEFAULT_LOSS_REASONS, LOSS_REASON_LABEL, type LossReasonDto } from "@/lib/types";

/**
 * Motivos de pérdida editables (tabla `loss_reason`). Una organización sin
 * filas usa los seis de siempre: se siembran la primera vez que se leen.
 * Quitar un motivo solo lo archiva; el nombre sigue sirviendo para el
 * historial. La clave de «otro» no se archiva (el sistema la usa).
 */
export const PROTECTED_KEY = "otro";
export const LABEL_MAX = 60;

const toDto = (r: typeof schema.lossReason.$inferSelect): LossReasonDto => ({
  id: r.id,
  key: r.key,
  label: r.label,
  active: r.active,
});

/** Todos los motivos de la organización (activos primero en su orden). */
export async function listLossReasons(organizationId: string): Promise<LossReasonDto[]> {
  const db = getDb();
  const read = () =>
    db
      .select()
      .from(schema.lossReason)
      .where(scoped(schema.lossReason.organizationId, organizationId))
      .orderBy(asc(schema.lossReason.position), asc(schema.lossReason.createdAt));
  let rows = await read();
  if (rows.length === 0) {
    await db
      .insert(schema.lossReason)
      .values(
        DEFAULT_LOSS_REASONS.map((r, i) => ({
          id: newId("lossReason"),
          organizationId,
          key: r.key,
          label: r.label,
          position: i,
        }))
      )
      .onConflictDoNothing();
    rows = await read();
  }
  return rows.map(toDto);
}

/** Clave → nombre, incluyendo los archivados (para pintar el historial). */
export async function lossReasonLabels(organizationId: string): Promise<Record<string, string>> {
  const rows = await getDb()
    .select({ key: schema.lossReason.key, label: schema.lossReason.label })
    .from(schema.lossReason)
    .where(scoped(schema.lossReason.organizationId, organizationId));
  return { ...LOSS_REASON_LABEL, ...Object.fromEntries(rows.map((r) => [r.key, r.label])) };
}

/** ¿Es `key` un motivo activo que se puede elegir hoy? */
export async function isActiveLossReason(organizationId: string, key: string): Promise<boolean> {
  const rows = await listLossReasons(organizationId);
  return rows.some((r) => r.key === key && r.active);
}

export async function createLossReason(organizationId: string, label: string): Promise<LossReasonDto> {
  await listLossReasons(organizationId); // asegura la siembra
  const db = getDb();
  const [max] = await db
    .select({ max: sql<number>`coalesce(max(${schema.lossReason.position}), -1)` })
    .from(schema.lossReason)
    .where(scoped(schema.lossReason.organizationId, organizationId));
  const [row] = await db
    .insert(schema.lossReason)
    .values({
      id: newId("lossReason"),
      organizationId,
      key: `m_${newId("lossReason").slice(4, 14)}`,
      label,
      position: (max?.max ?? -1) + 1,
    })
    .returning();
  return toDto(row!);
}

export type LossReasonPatch = { label?: string; active?: boolean; position?: number };

/** `null` = no existe; `"protected"` = intentó archivar «otro». */
export async function updateLossReason(
  organizationId: string,
  id: string,
  patch: LossReasonPatch
): Promise<LossReasonDto | null | "protected"> {
  const db = getDb();
  const [current] = await db.select().from(schema.lossReason).where(scoped(schema.lossReason.organizationId, organizationId, eq(schema.lossReason.id, id)));
  if (!current) return null;
  if (patch.active === false && current.key === PROTECTED_KEY) return "protected";
  const [row] = await db
    .update(schema.lossReason)
    .set({
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.position !== undefined ? { position: patch.position } : {}),
      updatedAt: new Date(),
    })
    .where(scoped(schema.lossReason.organizationId, organizationId, eq(schema.lossReason.id, id)))
    .returning();
  return row ? toDto(row) : null;
}
