import { eq } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";

/**
 * Fase 3, PR 2 — ¿Esta organización puede operar?
 *
 * Una organización `suspended` o `deleted` (borrado suave) NO:
 * - sus usuarios no inician sesión y las sesiones abiertas dejan de valer
 *   (`requireSession` y el hook de sesión de better-auth);
 * - sus webhooks no entran: se guardan en `webhook_unrouted` con motivo
 *   `org_suspended` (o `org_deleted`);
 * - no se envía nada: ni mensajes, ni plantillas, ni campañas, ni el agente,
 *   ni el cerebro externo.
 *
 * El estado lo decide la plataforma (pool de sistema). Se recuerda unos
 * segundos por proceso para no consultarlo en cada mensaje; quien lo cambia
 * en este proceso lo olvida al instante (`forgetOrgStatus`).
 */

export type OrgStatus = "active" | "suspended" | "deleted";

export class OrganizationInactiveError extends Error {
  constructor(readonly status: Exclude<OrgStatus, "active">) {
    super(
      status === "suspended"
        ? "La organización está suspendida: no se puede operar"
        : "La organización está dada de baja: no se puede operar"
    );
    this.name = "OrganizationInactiveError";
  }
}

const TTL_MS = 5_000;
const globalForStatus = globalThis as unknown as {
  __voceroOrgStatus?: Map<string, { status: OrgStatus | null; at: number }>;
};
function cache() {
  return (globalForStatus.__voceroOrgStatus ??= new Map());
}

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys() {
  return getSystemDb();
}

/** El estado, o `null` si la organización no existe. */
export async function getOrgStatus(organizationId: string): Promise<OrgStatus | null> {
  const hit = cache().get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.status;
  const [row] = await sys()
    .select({ status: schema.organization.status })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const status = row?.status ?? null;
  cache().set(organizationId, { status, at: Date.now() });
  return status;
}

export function forgetOrgStatus(organizationId?: string): void {
  if (organizationId) cache().delete(organizationId);
  else cache().clear();
}

export async function isOrgActive(organizationId: string): Promise<boolean> {
  return (await getOrgStatus(organizationId)) === "active";
}

/** Lanza `OrganizationInactiveError` si la organización no está activa. */
export async function assertOrgActive(organizationId: string): Promise<void> {
  const status = await getOrgStatus(organizationId);
  if (status === "active") return;
  throw new OrganizationInactiveError(status === "deleted" ? "deleted" : "suspended");
}
