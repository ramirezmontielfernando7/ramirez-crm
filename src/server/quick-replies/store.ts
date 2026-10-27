import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { QuickReplyDto } from "@/lib/quick-replies";

/**
 * Respuestas rápidas de la organización (tabla `quick_reply`). Las lee todo
 * el equipo (el compositor); las edita quien tiene `templates.manage`
 * (Propietario y Coordinador). Borrar es borrar: nada más las usa.
 */
const toDto = (r: typeof schema.quickReply.$inferSelect): QuickReplyDto => ({ id: r.id, shortcut: r.shortcut, body: r.body });

export async function listQuickReplies(organizationId: string): Promise<QuickReplyDto[]> {
  const rows = await getDb()
    .select()
    .from(schema.quickReply)
    .where(scoped(schema.quickReply.organizationId, organizationId))
    .orderBy(asc(schema.quickReply.shortcut));
  return rows.map(toDto);
}

/** `"duplicate"` = ya hay otra con ese atajo. */
export async function createQuickReply(
  organizationId: string,
  userId: string,
  input: { shortcut: string; body: string }
): Promise<QuickReplyDto | "duplicate"> {
  try {
    const [row] = await getDb()
      .insert(schema.quickReply)
      .values({ id: newId("quickReply"), organizationId, createdBy: userId, ...input })
      .returning();
    return toDto(row!);
  } catch (err) {
    if (isUniqueViolation(err)) return "duplicate";
    throw err;
  }
}

/** `null` = no existe; `"duplicate"` = el atajo nuevo ya lo usa otra. */
export async function updateQuickReply(
  organizationId: string,
  id: string,
  patch: { shortcut?: string; body?: string }
): Promise<QuickReplyDto | null | "duplicate"> {
  try {
    const [row] = await getDb()
      .update(schema.quickReply)
      .set({ ...patch, updatedAt: new Date() })
      .where(scoped(schema.quickReply.organizationId, organizationId, eq(schema.quickReply.id, id)))
      .returning();
    return row ? toDto(row) : null;
  } catch (err) {
    if (isUniqueViolation(err)) return "duplicate";
    throw err;
  }
}

export async function deleteQuickReply(organizationId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(schema.quickReply)
    .where(scoped(schema.quickReply.organizationId, organizationId, eq(schema.quickReply.id, id)))
    .returning({ id: schema.quickReply.id });
  return rows.length > 0;
}

/** 23505 = unique_violation de Postgres (Drizzle lo envuelve en `cause`). */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  if ((err as { code?: unknown }).code === "23505") return true;
  const cause = (err as { cause?: unknown }).cause;
  return typeof cause === "object" && cause !== null && (cause as { code?: unknown }).code === "23505";
}
