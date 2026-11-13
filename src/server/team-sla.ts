import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { normalizeTeamSla } from "@/lib/team-sla";

/** El límite de respuesta del equipo (`organization.metadata.teamSlaMinutes`, sin migración). */
function parse(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const p = JSON.parse(metadata) as unknown;
    return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function metadataOf(organizationId: string) {
  const rows = await getDb()
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return parse(rows[0]?.metadata ?? null);
}

export async function getTeamSla(organizationId: string): Promise<number> {
  return normalizeTeamSla((await metadataOf(organizationId)).teamSlaMinutes);
}

export async function saveTeamSla(organizationId: string, minutes: number): Promise<number> {
  const meta = await metadataOf(organizationId);
  const value = normalizeTeamSla(minutes);
  meta.teamSlaMinutes = value;
  await getDb()
    .update(schema.organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(schema.organization.id, organizationId));
  return value;
}
