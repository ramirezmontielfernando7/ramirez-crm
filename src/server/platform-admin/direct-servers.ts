import { getDb, schema } from "@/lib/db";
import { normalizeServerUrl } from "@/lib/direct-connection";
import { runWithOrganization } from "@/lib/request-context";
import { orgHasWhatsAppConnection } from "@/server/credentials";
import { getDirectSettings } from "@/server/direct-connection/settings";
import {
  assignServer,
  deleteServer,
  getConnection,
  getServer,
  openServerKey,
  insertServer,
  listServers,
  patchServer,
  type ServerPatch,
  type ServerSummary,
} from "@/server/credentials/direct";
import { pingServer } from "@/server/direct-connection/evolution-api";
import { instanceNameOf } from "@/server/direct-connection/link";
import { recordPlatformAudit, type AuditActor } from "./audit";
import { PlatformError } from "./organizations";

/**
 * Conexión directa (PR 1) — Los servidores del dispositivo vinculado, tal
 * como los administra /platform: alta, cambios y baja, cada uno en la
 * bitácora (sin la llave: solo que cambió). Solo el administrador de
 * plataforma; las empresas nunca ven nada de esto.
 */

export { listServers };

function url(raw: string): string {
  const u = normalizeServerUrl(raw);
  if (!u) throw new PlatformError(422, "invalid_url", "La dirección debe ser https:// (sin usuario, contraseña ni parámetros)");
  return u;
}

function duplicate(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export async function addServer(
  input: { name: string; baseUrl: string; apiKey: string; maxInstances?: number; notes?: string | null },
  actor: AuditActor,
  ip: string | null
): Promise<ServerSummary> {
  let server: ServerSummary;
  try {
    server = await insertServer({ ...input, baseUrl: url(input.baseUrl) }, actor?.userId ?? null);
  } catch (err) {
    if (duplicate(err)) throw new PlatformError(409, "duplicate", "Ese servidor ya está registrado");
    throw err;
  }
  await recordPlatformAudit({
    actor,
    action: "direct_server.added",
    detail: { servidor: server.id, nombre: server.name, url: server.baseUrl, capacidad: server.maxInstances },
    ip,
  });
  return server;
}

export async function changeServer(id: string, patch: ServerPatch, actor: AuditActor, ip: string | null): Promise<ServerSummary> {
  const clean: ServerPatch = { ...patch, ...(patch.baseUrl !== undefined ? { baseUrl: url(patch.baseUrl) } : {}) };
  let r: Awaited<ReturnType<typeof patchServer>>;
  try {
    r = await patchServer(id, clean);
  } catch (err) {
    if (duplicate(err)) throw new PlatformError(409, "duplicate", "Ese servidor ya está registrado");
    throw err;
  }
  if (!r) throw new PlatformError(404, "not_found", "Servidor no encontrado");
  const { before, after } = r;
  const campos = (["name", "baseUrl", "maxInstances", "status", "notes"] as const).filter((k) => before[k] !== after[k]);
  const detail: Record<string, unknown> = Object.fromEntries(campos.map((k) => [k, { de: before[k], a: after[k] }]));
  // De la llave solo queda que se cambió (y sus últimos 4), nunca su valor.
  if (patch.apiKey !== undefined) detail.llave = { de: `…${before.apiKeyLast4}`, a: `…${after.apiKeyLast4}` };
  if (Object.keys(detail).length > 0) {
    await recordPlatformAudit({ actor, action: "direct_server.changed", detail: { servidor: id, ...detail }, ip });
  }
  return after;
}

export async function removeServer(id: string, actor: AuditActor, ip: string | null): Promise<void> {
  const server = await getServer(id);
  const r = await deleteServer(id);
  if (r === "not_found") throw new PlatformError(404, "not_found", "Servidor no encontrado");
  if (r === "in_use") throw new PlatformError(409, "in_use", "El servidor tiene empresas conectadas: muévelas antes de borrarlo");
  await recordPlatformAudit({ actor, action: "direct_server.removed", detail: { servidor: id, nombre: server?.name ?? null }, ip });
}

/** Prueba de /platform: ¿la dirección responde y la llave sirve? Nunca devuelve la llave. */
export async function testServer(id: string): Promise<{ ok: boolean; instances?: number; error?: string }> {
  const key = await openServerKey(id);
  if (!key.ok) {
    if (key.error === "not_found") throw new PlatformError(404, "not_found", "Servidor no encontrado");
    return { ok: false, error: "No se pudo abrir la llave guardada (revisa ENCRYPTION_KEY)" };
  }
  const r = await pingServer({ baseUrl: key.baseUrl, apiKey: key.apiKey });
  if (r.ok) return { ok: true, instances: r.data.instances };
  return {
    ok: false,
    error: r.error === "unreachable" ? "El servidor no responde" : r.error === "not_found" ? "La dirección no es de un servidor válido" : "El servidor rechazó la llave",
  };
}

export type OrganizationDirect = {
  serverId: string | null;
  serverName: string | null;
  status: "pending" | "connecting" | "connected" | "disconnected" | null;
  phoneNumber: string | null;
  /** Con instancia creada, el servidor ya no se puede cambiar. */
  locked: boolean;
  /** PR 6: la empresa no tiene número de Meta (opera solo con el dispositivo). */
  metaless: boolean;
  /** PR 6: «IA por conexión directa» (solo cuenta en una empresa sin Meta). */
  aiViaDirect: boolean;
};

export async function organizationDirect(organizationId: string): Promise<OrganizationDirect> {
  const [row, extra] = await Promise.all([
    getConnection(organizationId),
    runWithOrganization(organizationId, async () => {
      const [hasMeta, settings] = await Promise.all([orgHasWhatsAppConnection(organizationId), getDirectSettings(organizationId)]);
      return { metaless: !hasMeta, aiViaDirect: settings.aiViaDirect };
    }),
  ]);
  if (!row) return { serverId: null, serverName: null, status: null, phoneNumber: null, locked: false, ...extra };
  const server = await getServer(row.serverId);
  return {
    serverId: row.serverId,
    serverName: server?.name ?? null,
    status: row.status,
    phoneNumber: row.phoneNumber,
    locked: row.instanceKeyCipher !== null,
    ...extra,
  };
}

/**
 * PR 6 — «IA por conexión directa»: en una empresa SIN Meta, la IA contesta
 * por el dispositivo vinculado (con los mismos límites de envío). Apagado de
 * fábrica. Con Meta no cambia nada: la IA sale siempre por Meta.
 */
export async function setOrganizationAiViaDirect(
  organizationId: string,
  on: boolean,
  actor: AuditActor,
  ip: string | null
): Promise<OrganizationDirect> {
  await runWithOrganization(organizationId, () =>
    getDb()
      .insert(schema.directConnectionSettings)
      .values({ organizationId, aiViaDirect: on, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.directConnectionSettings.organizationId, set: { aiViaDirect: on, updatedAt: new Date() } })
  );
  await recordPlatformAudit({ actor, action: "direct_connection.ai_changed", org: { id: organizationId, name: organizationId }, detail: { ia: on }, ip });
  return organizationDirect(organizationId);
}

export async function assignOrganizationServer(organizationId: string, serverId: string, actor: AuditActor, ip: string | null): Promise<OrganizationDirect> {
  const r = await assignServer(organizationId, serverId, instanceNameOf(organizationId));
  if (r === "server_not_found") throw new PlatformError(404, "not_found", "Servidor no encontrado");
  if (r === "has_instance") throw new PlatformError(409, "has_instance", "La empresa ya vinculó su dispositivo: para cambiar de servidor, primero que lo desvincule");
  await recordPlatformAudit({ actor, action: "direct_connection.server_assigned", org: { id: organizationId, name: organizationId }, detail: { servidor: serverId }, ip });
  return organizationDirect(organizationId);
}
