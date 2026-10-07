import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { runWithOrganization } from "@/lib/request-context";
import { logger } from "@/lib/log";
import {
  DEFAULT_APPEARANCE,
  normalizeOrgAppearance,
  type OrgAppearance,
} from "@/lib/appearance";

const log = logger("appearance");

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * La apariencia de la ORGANIZACIÓN (`organization.metadata.appearance`, sin
 * migración). Sin organización (login) o si la lectura falla: los valores de
 * fábrica; una letra nunca debe romper la página.
 */
export async function getOrgAppearance(
  organizationId?: string | null
): Promise<OrgAppearance> {
  if (!organizationId) return DEFAULT_APPEARANCE;
  try {
    const rows = await runWithOrganization(organizationId, () =>
      getDb()
        .select({ metadata: schema.organization.metadata })
        .from(schema.organization)
        .where(eq(schema.organization.id, organizationId))
        .limit(1)
    );
    return normalizeOrgAppearance(parseMetadata(rows[0]?.metadata ?? null).appearance);
  } catch (err) {
    log.error("no se pudo leer la apariencia", { org: organizationId, err });
    return DEFAULT_APPEARANCE;
  }
}

/** Guarda lo indicado y conserva el resto del JSON (la marca vive en el mismo campo). */
export async function saveOrgAppearance(
  organizationId: string,
  patch: Partial<OrgAppearance>
): Promise<OrgAppearance> {
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const meta = parseMetadata(rows[0]?.metadata ?? null);
  const next = normalizeOrgAppearance({ ...normalizeOrgAppearance(meta.appearance), ...patch });
  meta.appearance = next;
  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(schema.organization.id, organizationId));
  return next;
}
