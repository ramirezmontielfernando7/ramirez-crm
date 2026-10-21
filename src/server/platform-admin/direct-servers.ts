import { normalizeServerUrl } from "@/lib/direct-connection";
import {
  deleteServer,
  getServer,
  insertServer,
  listServers,
  patchServer,
  type ServerPatch,
  type ServerSummary,
} from "@/server/credentials/direct";
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
