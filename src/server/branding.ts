import { eq } from "drizzle-orm";
import { runWithOrganization } from "@/lib/request-context";
import { getDb, schema } from "@/lib/db";
import { getSessionOrNull } from "@/lib/auth/session";
import {
  normalizeBranding,
  PLATFORM_BRANDING,
  type Branding,
} from "@/lib/branding";
import { logger } from "@/lib/log";

const log = logger("branding");

/** Marca guardada en organization.metadata (JSON de Better Auth). */

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
 * Marca + a qué organización pertenece.
 *
 * El icono se guarda como archivo en `MEDIA_DIR/{organizationId}/favicon`, así
 * que servirlo necesita el id.
 *
 * H11: sin organización (sin sesión: login, pestaña, favicon público) es la
 * marca NEUTRA de la plataforma, sin tocar la BD. Nunca "la primera
 * organización": eso le enseñaba el nombre y el logo de un cliente a
 * cualquiera que abriera el login.
 */
export async function getBrandingContext(
  organizationId?: string | null
): Promise<{ organizationId: string | null; branding: Branding }> {
  if (!organizationId) return { organizationId: null, branding: PLATFORM_BRANDING };
  const db = getDb();
  // PR 3: la llaman el layout raíz y el favicon, fuera de `withAuth`; la
  // consulta va a nombre de la organización que se pide.
  const rows = await runWithOrganization(organizationId, () => db
    .select({ id: schema.organization.id, metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1));
  if (!rows[0]) return { organizationId: null, branding: PLATFORM_BRANDING };
  const meta = parseMetadata(rows[0].metadata);
  return {
    organizationId: rows[0].id,
    branding: normalizeBranding(
      (meta.branding as Partial<Branding> | undefined) ?? null
    ),
  };
}

/**
 * La marca de quien está viendo la página: la de su organización si tiene
 * sesión, la de la plataforma si no. Para el layout raíz y el favicon, que
 * sirven a los dos. Si la BD falla, la página se dibuja con la marca de la
 * plataforma y el error queda en el log (nunca una página rota por la marca).
 */
export async function getViewerBrandingContext(): Promise<{
  organizationId: string | null;
  branding: Branding;
}> {
  const session = await getSessionOrNull();
  try {
    return await getBrandingContext(session?.organizationId);
  } catch (err) {
    log.error("no se pudo leer la marca", { org: session?.organizationId ?? null, err });
    return { organizationId: null, branding: PLATFORM_BRANDING };
  }
}

export async function getBranding(
  organizationId?: string | null
): Promise<Branding> {
  return (await getBrandingContext(organizationId)).branding;
}

export async function saveBranding(
  organizationId: string,
  branding: Branding
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const meta = parseMetadata(rows[0]?.metadata ?? null);
  meta.branding = normalizeBranding(branding);
  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(schema.organization.id, organizationId));
}
