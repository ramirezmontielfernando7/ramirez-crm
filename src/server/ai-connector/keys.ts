import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  KEY_PREFIX,
  normalizeAssistantName,
  normalizeScopes,
  roleMayConnect,
  tokenPrefix,
  type Scope,
} from "@/lib/ai-connector";
import type { SessionContext } from "@/lib/auth/session";
import { orgHasConectorIa } from "@/server/modules";
import { getConnectorSettings } from "@/server/ai-connector/settings";
import { logger } from "@/lib/log";

const log = logger("ai-connector");

/**
 * 047 — Conexiones de IA y sus llaves. Solo se guarda el SHA-256 (32 bytes
 * aleatorios: no hace falta un hash lento); la llave en claro solo existe al
 * crearla. ÚNICA puerta de `ai_connection` y `ai_token`.
 */

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateToken(prefix: string): string {
  return prefix + randomBytes(32).toString("base64url");
}

export type ResolvedToken = {
  tokenId: string;
  connectionId: string;
  organizationId: string;
  userId: string;
  scopes: Scope[];
  assistantName: string | null;
};

/**
 * La conexión de una llave de acceso o personal VIVA (sin revocar, sin
 * caducar, conexión sin revocar), o null. Por hash exacto (índice único).
 * Es lo que decide la organización y la persona de la llamada: pool de
 * sistema. Una llave de renovación nunca abre el conector.
 */
export async function resolveToken(token: string, now = new Date()): Promise<ResolvedToken | null> {
  const rows = await getSystemDb()
    .select({
      tokenId: schema.aiToken.id,
      connectionId: schema.aiConnection.id,
      organizationId: schema.aiConnection.organizationId,
      userId: schema.aiConnection.userId,
      scopes: schema.aiConnection.scopes,
      assistantName: schema.aiConnection.assistantName,
    })
    .from(schema.aiToken)
    .innerJoin(
      schema.aiConnection,
      and(
        eq(schema.aiConnection.organizationId, schema.aiToken.organizationId),
        eq(schema.aiConnection.id, schema.aiToken.connectionId)
      )
    )
    .where(
      and(
        eq(schema.aiToken.tokenHash, hashToken(token)),
        or(eq(schema.aiToken.kind, "access"), eq(schema.aiToken.kind, "key")),
        isNull(schema.aiToken.revokedAt),
        isNull(schema.aiConnection.revokedAt),
        or(isNull(schema.aiToken.expiresAt), gt(schema.aiToken.expiresAt, now))
      )
    )
    .limit(1);
  const row = rows[0];
  return row ? { ...row, scopes: normalizeScopes(row.scopes) } : null;
}

/** ¿Puede esta persona conectar su IA hoy? (complemento + ajustes del Propietario). */
export async function mayConnect(session: SessionContext): Promise<boolean> {
  if (!(await orgHasConectorIa(session.organizationId))) return false;
  return roleMayConnect(session.role, await getConnectorSettings(session.organizationId));
}

export type ConnectionDto = {
  id: string;
  kind: "oauth" | "key";
  name: string;
  /** «Joe»: cómo firma esta IA en la Bandeja; null = «Asistente». */
  assistantName: string | null;
  scopes: Scope[];
  tokenPrefix: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

/**
 * Llave personal nueva («n8n de Ana»). Devuelve la llave en claro UNA vez.
 * `null` si la persona no puede conectar su IA.
 */
export async function createPersonalKey(
  session: SessionContext,
  input: { name: string; scopes: readonly string[]; assistantName?: string | null }
): Promise<{ key: string; connection: ConnectionDto } | null> {
  if (!(await mayConnect(session))) return null;
  const key = generateToken(KEY_PREFIX);
  const id = newId("aiConnection");
  const scopes = normalizeScopes(input.scopes);
  const assistantName = normalizeAssistantName(input.assistantName);
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await tx.insert(schema.aiConnection).values({
      id,
      organizationId: session.organizationId,
      userId: session.userId,
      kind: "key",
      name: input.name.trim().slice(0, 80),
      assistantName,
      scopes,
      createdAt: now,
    });
    await tx.insert(schema.aiToken).values({
      id: newId("aiToken"),
      organizationId: session.organizationId,
      connectionId: id,
      kind: "key",
      tokenHash: hashToken(key),
      tokenPrefix: tokenPrefix(key),
      createdAt: now,
    });
  });
  return {
    key,
    connection: {
      id,
      kind: "key",
      name: input.name.trim().slice(0, 80),
      assistantName,
      scopes,
      tokenPrefix: tokenPrefix(key),
      createdAt: now.toISOString(),
      lastUsedAt: null,
    },
  };
}

/** Las conexiones vivas de quien pide (cada quien ve solo las suyas). */
export async function listMyConnections(session: SessionContext): Promise<ConnectionDto[]> {
  const rows = await getDb()
    .select({
      id: schema.aiConnection.id,
      kind: schema.aiConnection.kind,
      name: schema.aiConnection.name,
      assistantName: schema.aiConnection.assistantName,
      scopes: schema.aiConnection.scopes,
      createdAt: schema.aiConnection.createdAt,
      lastUsedAt: schema.aiConnection.lastUsedAt,
      tokenPrefix: schema.aiToken.tokenPrefix,
    })
    .from(schema.aiConnection)
    .leftJoin(
      schema.aiToken,
      and(
        eq(schema.aiToken.organizationId, schema.aiConnection.organizationId),
        eq(schema.aiToken.connectionId, schema.aiConnection.id),
        eq(schema.aiToken.kind, "key")
      )
    )
    .where(
      scoped(
        schema.aiConnection.organizationId,
        session.organizationId,
        eq(schema.aiConnection.userId, session.userId),
        isNull(schema.aiConnection.revokedAt)
      )
    )
    .orderBy(schema.aiConnection.createdAt);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    assistantName: r.assistantName,
    scopes: normalizeScopes(r.scopes),
    tokenPrefix: r.tokenPrefix,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  }));
}

/**
 * Desconecta una IA de quien pide: la conexión y TODAS sus llaves dejan de
 * valer al instante. false si no existe o no es suya.
 */
export async function revokeConnection(session: SessionContext, connectionId: string): Promise<boolean> {
  const now = new Date();
  return getDb().transaction(async (tx) => {
    const done = await tx
      .update(schema.aiConnection)
      .set({ revokedAt: now, revokedBy: session.userId })
      .where(
        scoped(
          schema.aiConnection.organizationId,
          session.organizationId,
          eq(schema.aiConnection.id, connectionId),
          eq(schema.aiConnection.userId, session.userId),
          isNull(schema.aiConnection.revokedAt)
        )
      )
      .returning({ id: schema.aiConnection.id });
    if (done.length === 0) return false;
    await tx
      .update(schema.aiToken)
      .set({ revokedAt: now })
      .where(
        scoped(
          schema.aiToken.organizationId,
          session.organizationId,
          eq(schema.aiToken.connectionId, connectionId),
          isNull(schema.aiToken.revokedAt)
        )
      );
    return true;
  });
}

/**
 * Le pone (o quita, con null) nombre a una IA de quien pide: lo que firme
 * desde ahora dice ese nombre; lo ya enviado conserva el que tenía.
 */
export async function renameAssistant(
  session: SessionContext,
  connectionId: string,
  name: string | null
): Promise<boolean> {
  const done = await getDb()
    .update(schema.aiConnection)
    .set({ assistantName: normalizeAssistantName(name) })
    .where(
      scoped(
        schema.aiConnection.organizationId,
        session.organizationId,
        eq(schema.aiConnection.id, connectionId),
        eq(schema.aiConnection.userId, session.userId),
        isNull(schema.aiConnection.revokedAt)
      )
    )
    .returning({ id: schema.aiConnection.id });
  return done.length > 0;
}

/**
 * `last_used_at` como mucho una vez por minuto por conexión: una IA hace
 * varias llamadas por pedido y no hace falta una escritura en cada una.
 */
const LAST_USED_EVERY_MS = 60_000;
const globalForKeys = globalThis as unknown as { __voceroAiConnTouched?: Map<string, number> };

export async function touchConnection(connectionId: string, organizationId: string, now = Date.now()): Promise<void> {
  const touched = (globalForKeys.__voceroAiConnTouched ??= new Map());
  if (now - (touched.get(connectionId) ?? 0) < LAST_USED_EVERY_MS) return;
  touched.set(connectionId, now);
  try {
    await getDb()
      .update(schema.aiConnection)
      .set({ lastUsedAt: new Date(now) })
      .where(scoped(schema.aiConnection.organizationId, organizationId, eq(schema.aiConnection.id, connectionId)));
  } catch (err) {
    // Solo es un dato para la lista de Ajustes: no se tumba la llamada.
    log.error("no se pudo anotar el uso de la conexión", { org: organizationId, err });
  }
}
