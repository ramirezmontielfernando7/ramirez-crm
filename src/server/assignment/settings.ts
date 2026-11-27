import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { AssignmentMode } from "@/lib/assignment-mode";

/** Modo de reparto de la organización (`assignment_settings`); sin fila = a mano. */
export async function getAssignmentMode(organizationId: string): Promise<AssignmentMode> {
  const rows = await getDb()
    .select({ mode: schema.assignmentSettings.mode })
    .from(schema.assignmentSettings)
    .where(scoped(schema.assignmentSettings.organizationId, organizationId))
    .limit(1);
  return rows[0]?.mode ?? "manual";
}

export async function setAssignmentMode(organizationId: string, mode: AssignmentMode): Promise<AssignmentMode> {
  await getDb()
    .insert(schema.assignmentSettings)
    .values({ organizationId, mode })
    .onConflictDoUpdate({
      target: [schema.assignmentSettings.organizationId],
      set: { mode, updatedAt: new Date() },
    });
  return mode;
}
