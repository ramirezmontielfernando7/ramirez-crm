import { asc, count, eq, inArray } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { last4, pickServer } from "@/lib/direct-connection";
import { open, seal, type OpenFailure } from "./vault";

/**
 * Conexión directa (PR 1) — Los servidores del dispositivo vinculado
 * (`evolution_server`) y su llave maestra, cifrada con ENCRYPTION_KEY. Tabla
 * de PLATAFORMA: solo el pool de sistema (la app atendiendo a una
 * organización no la puede leer). Aquí, y solo aquí, se cifra y descifra esa
 * llave; lo que sale hacia /platform lleva solo sus últimos 4.
 *
 * La llave de la instancia de cada organización (`direct_connection`) se
 * guardará con `sealForStorage` cuando el PR 2 la cree.
 */

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys() {
  return getSystemDb();
}

export type ServerStatus = "active" | "full" | "disabled";

/** Lo que ve /platform de un servidor: jamás la llave, solo sus últimos 4. */
export type ServerSummary = {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyLast4: string;
  maxInstances: number;
  status: ServerStatus;
  notes: string | null;
  /** Empresas con conexión en este servidor. */
  used: number;
  createdAt: string;
  updatedAt: string;
};

type Row = typeof schema.evolutionServer.$inferSelect;

function summary(r: Row, used: number): ServerSummary {
  return {
    id: r.id,
    name: r.name,
    baseUrl: r.baseUrl,
    apiKeyLast4: r.apiKeyLast4,
    maxInstances: r.maxInstances,
    status: r.status,
    notes: r.notes,
    used,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function usedBy(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await sys()
    .select({ server: schema.directConnection.serverId, n: count() })
    .from(schema.directConnection)
    .where(inArray(schema.directConnection.serverId, ids))
    .groupBy(schema.directConnection.serverId);
  return new Map(rows.map((r) => [r.server, Number(r.n)]));
}

export async function listServers(): Promise<ServerSummary[]> {
  const rows = await sys().select().from(schema.evolutionServer).orderBy(asc(schema.evolutionServer.createdAt));
  const used = await usedBy(rows.map((r) => r.id));
  return rows.map((r) => summary(r, used.get(r.id) ?? 0));
}

export async function getServer(id: string): Promise<ServerSummary | null> {
  const [row] = await sys().select().from(schema.evolutionServer).where(eq(schema.evolutionServer.id, id)).limit(1);
  if (!row) return null;
  return summary(row, (await usedBy([id])).get(id) ?? 0);
}

export type NewServer = {
  name: string;
  /** Ya normalizada (`normalizeServerUrl`). */
  baseUrl: string;
  apiKey: string;
  maxInstances?: number;
  notes?: string | null;
};

export async function insertServer(input: NewServer, createdBy: string | null): Promise<ServerSummary> {
  const sealed = seal(input.apiKey);
  const [row] = await sys()
    .insert(schema.evolutionServer)
    .values({
      id: newId("evolutionServer"),
      name: input.name,
      baseUrl: input.baseUrl,
      apiKeyCipher: sealed.cipher,
      apiKeyIv: sealed.iv,
      apiKeyTag: sealed.tag,
      apiKeyLast4: last4(input.apiKey),
      keyVersion: sealed.keyVersion,
      maxInstances: input.maxInstances ?? 25,
      notes: input.notes ?? null,
      createdBy,
    })
    .returning();
  return summary(row!, 0);
}

export type ServerPatch = {
  name?: string;
  baseUrl?: string;
  /** Una llave nueva reemplaza a la anterior (se cifra de nuevo). */
  apiKey?: string;
  maxInstances?: number;
  status?: ServerStatus;
  notes?: string | null;
};

export async function patchServer(id: string, patch: ServerPatch): Promise<{ before: ServerSummary; after: ServerSummary } | null> {
  const before = await getServer(id);
  if (!before) return null;
  const set: Partial<typeof schema.evolutionServer.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.baseUrl !== undefined) set.baseUrl = patch.baseUrl;
  if (patch.maxInstances !== undefined) set.maxInstances = patch.maxInstances;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.apiKey !== undefined) {
    const sealed = seal(patch.apiKey);
    Object.assign(set, {
      apiKeyCipher: sealed.cipher,
      apiKeyIv: sealed.iv,
      apiKeyTag: sealed.tag,
      apiKeyLast4: last4(patch.apiKey),
      keyVersion: sealed.keyVersion,
    });
  }
  await sys().update(schema.evolutionServer).set(set).where(eq(schema.evolutionServer.id, id));
  const after = await getServer(id);
  return after ? { before, after } : null;
}

/** Borra un servidor sin empresas. Con empresas: `in_use` (la FK también lo impide). */
export async function deleteServer(id: string): Promise<"deleted" | "not_found" | "in_use"> {
  const current = await getServer(id);
  if (!current) return "not_found";
  if (current.used > 0) return "in_use";
  await sys().delete(schema.evolutionServer).where(eq(schema.evolutionServer.id, id));
  return "deleted";
}

/**
 * La llave maestra en claro, para hablar con el servidor (PR 2). Nunca sale
 * del servidor de Dashfort ni se registra en el log.
 */
export async function openServerKey(
  id: string
): Promise<{ ok: true; baseUrl: string; apiKey: string } | { ok: false; error: "not_found" | OpenFailure }> {
  const [row] = await sys().select().from(schema.evolutionServer).where(eq(schema.evolutionServer.id, id)).limit(1);
  if (!row) return { ok: false, error: "not_found" };
  const r = open(row.apiKeyCipher, row.apiKeyIv, row.apiKeyTag, row.keyVersion);
  return r.ok ? { ok: true, baseUrl: row.baseUrl, apiKey: r.value } : { ok: false, error: r.error };
}

/** El servidor para una empresa nueva: el activo con más lugar libre (o null). */
export async function serverForNewOrganization(): Promise<ServerSummary | null> {
  return pickServer(await listServers());
}
