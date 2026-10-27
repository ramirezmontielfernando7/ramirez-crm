import { createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  ACCESS_PREFIX,
  ACCESS_TTL_MS,
  CLIENT_PREFIX,
  CODE_PREFIX,
  CODE_TTL_MS,
  REFRESH_PREFIX,
  REFRESH_TTL_MS,
  isAllowedRedirectUri,
  isCimdClientId,
  normalizeScopes,
  roleMayConnect,
  tokenPrefix,
  type Scope,
} from "@/lib/ai-connector";
import type { SessionContext } from "@/lib/auth/session";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/log";
import { runWithOrganization } from "@/lib/request-context";
import { generateToken, hashToken, mayConnect } from "@/server/ai-connector/keys";
import { getConnectorSettings } from "@/server/ai-connector/settings";
import { resolveMembership } from "@/server/auth/on-signup";
import { orgHasConectorIa } from "@/server/modules";
import { isOrgActive } from "@/server/platform-admin/org-status";

const log = logger("ai-connector");

/**
 * 047 PR 3 — «Iniciar sesión» OAuth 2.1 del conector de IA. Dashfort es su
 * propio servidor de autorización: la persona entra con su cuenta y acepta
 * en la pantalla de Dashfort; la app (Claude, ChatGPT…) recibe un código de
 * un solo uso y lo cambia, con PKCE, por llaves de ESA persona.
 *
 * Clientes: CIMD (el `client_id` es la URL de sus metadatos) o registro
 * dinámico (RFC 7591, tabla de plataforma `ai_oauth_client`).
 */

export const MCP_RESOURCE = () => `${getEnv().APP_BASE_URL.replace(/\/+$/, "")}/api/mcp`;

export type OAuthClient = { clientId: string; clientName: string; redirectUris: string[] };

/* ---------- Registro dinámico (RFC 7591) ---------- */

export const registerSchema = z.object({
  client_name: z.string().trim().min(1).max(100).optional(),
  redirect_uris: z.array(z.string().max(500)).min(1).max(10),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

export async function registerClient(input: z.infer<typeof registerSchema>): Promise<OAuthClient | "invalid_redirect_uri"> {
  if (!input.redirect_uris.every(isAllowedRedirectUri)) return "invalid_redirect_uri";
  const client: OAuthClient = {
    clientId: CLIENT_PREFIX + randomBytes(16).toString("hex"),
    clientName: input.client_name ?? "App de IA",
    redirectUris: input.redirect_uris,
  };
  // Antes de saber de qué organización es la persona: tabla de plataforma.
  await getSystemDb().insert(schema.aiOauthClient).values(client);
  return client;
}

/* ---------- CIMD: el client_id es la URL de sus metadatos ---------- */

const cimdSchema = z.object({
  client_id: z.string(),
  client_name: z.string().trim().min(1).max(100).optional(),
  redirect_uris: z.array(z.string().max(500)).min(1).max(10),
});

/** ¿Es una dirección de la red interna? (contra SSRF al leer metadatos ajenos). */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

const CIMD_MAX_BYTES = 10_000;
const CIMD_TIMEOUT_MS = 5_000;

async function fetchCimd(clientId: string): Promise<OAuthClient | null> {
  try {
    const url = new URL(clientId);
    const addrs = await lookup(url.hostname, { all: true });
    if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) return null;
    const res = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > CIMD_MAX_BYTES) return null;
    const doc = cimdSchema.safeParse(JSON.parse(text));
    if (!doc.success || doc.data.client_id !== clientId) return null;
    if (!doc.data.redirect_uris.every(isAllowedRedirectUri)) return null;
    return { clientId, clientName: doc.data.client_name ?? url.hostname, redirectUris: doc.data.redirect_uris };
  } catch (err) {
    log.warn("no se pudieron leer los metadatos del cliente OAuth", { host: safeHost(clientId), err });
    return null;
  }
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return "?";
  }
}

/** El cliente de un `client_id`, o null si no existe o sus metadatos no sirven. */
export async function resolveClient(clientId: string): Promise<OAuthClient | null> {
  if (isCimdClientId(clientId)) return fetchCimd(clientId);
  if (!clientId.startsWith(CLIENT_PREFIX)) return null;
  const [row] = await getSystemDb()
    .select({
      clientId: schema.aiOauthClient.clientId,
      clientName: schema.aiOauthClient.clientName,
      redirectUris: schema.aiOauthClient.redirectUris,
    })
    .from(schema.aiOauthClient)
    .where(eq(schema.aiOauthClient.clientId, clientId))
    .limit(1);
  return row ?? null;
}

/* ---------- Pantalla de aceptar → código ---------- */

export const authorizeSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(500),
  redirect_uri: z.string().min(1).max(500),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(500).optional(),
  scope: z.string().max(100).optional(),
  resource: z.string().max(500).optional(),
});
export type AuthorizeParams = z.infer<typeof authorizeSchema>;

/**
 * Lo que la pantalla necesita para mostrar «X quiere actuar como tú», o el
 * motivo por el que no se puede (sin redirigir a una URI no registrada).
 */
export async function checkAuthorizeRequest(
  params: AuthorizeParams
): Promise<{ ok: true; client: OAuthClient } | { ok: false; reason: "client" | "redirect_uri" | "resource" }> {
  const client = await resolveClient(params.client_id);
  if (!client) return { ok: false, reason: "client" };
  if (!client.redirectUris.includes(params.redirect_uri)) return { ok: false, reason: "redirect_uri" };
  if (params.resource && params.resource.replace(/\/+$/, "") !== MCP_RESOURCE()) return { ok: false, reason: "resource" };
  return { ok: true, client };
}

/**
 * La persona aceptó: código de un solo uso y la URL a la que regresa la app
 * (con `code`, `state` e `iss`, RFC 9207). null si no puede conectar su IA.
 */
export async function approveAuthorization(
  session: SessionContext,
  params: AuthorizeParams,
  client: OAuthClient,
  scopes: readonly Scope[]
): Promise<string | null> {
  if (!(await mayConnect(session))) return null;
  const code = generateToken(CODE_PREFIX);
  await getDb()
    .insert(schema.aiOauthCode)
    .values({
      id: newId("aiOauthCode"),
      organizationId: session.organizationId,
      userId: session.userId,
      codeHash: hashToken(code),
      clientId: client.clientId,
      clientName: client.clientName,
      redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge,
      resource: MCP_RESOURCE(),
      scopes: normalizeScopes(scopes),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
  return redirectWith(params.redirect_uri, { code, state: params.state, iss: getEnv().APP_BASE_URL.replace(/\/+$/, "") });
}

/** La URL de regreso con un error de OAuth (la persona dijo que no). */
export function denyRedirect(params: AuthorizeParams): string {
  return redirectWith(params.redirect_uri, {
    error: "access_denied",
    state: params.state,
    iss: getEnv().APP_BASE_URL.replace(/\/+$/, ""),
  });
}

function redirectWith(uri: string, q: Record<string, string | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(q)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/* ---------- Token endpoint ---------- */

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};
export type TokenError = { error: "invalid_grant" | "invalid_request" | "invalid_client" | "invalid_target"; description: string };

function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** ¿La persona todavía puede usar su IA en esa organización? */
async function stillAllowed(organizationId: string, userId: string): Promise<boolean> {
  if (!(await isOrgActive(organizationId))) return false;
  const membership = await resolveMembership(userId, organizationId);
  if (!membership || membership.organizationId !== organizationId) return false;
  return runWithOrganization(organizationId, async () => {
    if (!(await orgHasConectorIa(organizationId))) return false;
    return roleMayConnect(membership.role, await getConnectorSettings(organizationId));
  });
}

async function issuePair(
  tx: Parameters<Parameters<ReturnType<typeof getSystemDb>["transaction"]>[0]>[0],
  organizationId: string,
  connectionId: string,
  scopes: Scope[],
  now: Date
): Promise<TokenResponse> {
  const access = generateToken(ACCESS_PREFIX);
  const refresh = generateToken(REFRESH_PREFIX);
  await tx.insert(schema.aiToken).values([
    {
      id: newId("aiToken"),
      organizationId,
      connectionId,
      kind: "access",
      tokenHash: hashToken(access),
      tokenPrefix: tokenPrefix(access),
      expiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
      createdAt: now,
    },
    {
      id: newId("aiToken"),
      organizationId,
      connectionId,
      kind: "refresh",
      tokenHash: hashToken(refresh),
      tokenPrefix: tokenPrefix(refresh),
      expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
      createdAt: now,
    },
  ]);
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refresh,
    scope: scopes.join(" "),
  };
}

/**
 * `authorization_code`: el código vale una vez, 10 minutos, para el mismo
 * cliente y la misma `redirect_uri`, con el verificador PKCE correcto. Nace
 * la conexión «Claude de Ana» con su par de llaves. Todo se decide por el
 * hash del código: pool de sistema (aún no se sabe la organización).
 */
export async function exchangeCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  resource?: string | null;
}): Promise<TokenResponse | TokenError> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)) {
    return { error: "invalid_request", description: "code_verifier no válido" };
  }
  if (input.resource && input.resource.replace(/\/+$/, "") !== MCP_RESOURCE()) {
    return { error: "invalid_target", description: "Esta llave solo vale para el conector de Dashfort" };
  }
  const now = new Date();
  const db = getSystemDb();
  const [row] = await db
    .update(schema.aiOauthCode)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.aiOauthCode.codeHash, hashToken(input.code)),
        isNull(schema.aiOauthCode.usedAt),
        gt(schema.aiOauthCode.expiresAt, now)
      )
    )
    .returning();
  if (!row) return { error: "invalid_grant", description: "El código ya se usó, caducó o no existe" };
  if (row.clientId !== input.clientId || row.redirectUri !== input.redirectUri) {
    return { error: "invalid_grant", description: "El código es de otra app o de otra dirección de regreso" };
  }
  if (pkceS256(input.codeVerifier) !== row.codeChallenge) {
    return { error: "invalid_grant", description: "El verificador PKCE no coincide" };
  }
  if (!(await stillAllowed(row.organizationId, row.userId))) {
    return { error: "invalid_grant", description: "Esta persona ya no puede conectar su IA" };
  }
  const scopes = normalizeScopes(row.scopes);
  return db.transaction(async (tx) => {
    const connectionId = newId("aiConnection");
    await tx.insert(schema.aiConnection).values({
      id: connectionId,
      organizationId: row.organizationId,
      userId: row.userId,
      kind: "oauth",
      name: row.clientName.slice(0, 80),
      clientId: row.clientId,
      scopes,
      createdAt: now,
    });
    return issuePair(tx, row.organizationId, connectionId, scopes, now);
  });
}

/**
 * `refresh_token`: ROTA (la usada deja de valer). Si alguien presenta una de
 * renovación que ya se usó, se asume robo y la conexión entera se revoca.
 */
export async function refreshTokens(input: { refreshToken: string; clientId: string }): Promise<TokenResponse | TokenError> {
  const now = new Date();
  const db = getSystemDb();
  const [found] = await db
    .select({ token: schema.aiToken, connection: schema.aiConnection })
    .from(schema.aiToken)
    .innerJoin(
      schema.aiConnection,
      and(
        eq(schema.aiConnection.organizationId, schema.aiToken.organizationId),
        eq(schema.aiConnection.id, schema.aiToken.connectionId)
      )
    )
    .where(and(eq(schema.aiToken.tokenHash, hashToken(input.refreshToken)), eq(schema.aiToken.kind, "refresh")))
    .limit(1);
  if (!found) return { error: "invalid_grant", description: "Llave de renovación no válida" };
  const { token, connection } = found;
  if (connection.clientId !== input.clientId) return { error: "invalid_grant", description: "La llave es de otra app" };
  if (token.revokedAt) {
    // Reúso de una llave ya rotada: alguien más la tiene.
    if (!connection.revokedAt) await revokeConnectionById(connection.organizationId, connection.id, now);
    log.warn("llave de renovación reutilizada: conexión revocada", { org: connection.organizationId, connection: connection.id });
    return { error: "invalid_grant", description: "Llave de renovación ya usada: conexión cerrada por seguridad" };
  }
  if (connection.revokedAt || (token.expiresAt && token.expiresAt <= now)) {
    return { error: "invalid_grant", description: "La conexión se cerró o la llave caducó" };
  }
  if (!(await stillAllowed(connection.organizationId, connection.userId))) {
    return { error: "invalid_grant", description: "Esta persona ya no puede conectar su IA" };
  }
  const scopes = normalizeScopes(connection.scopes);
  return db.transaction(async (tx) => {
    await tx
      .update(schema.aiToken)
      .set({ revokedAt: now })
      .where(and(eq(schema.aiToken.id, token.id), isNull(schema.aiToken.revokedAt)));
    return issuePair(tx, connection.organizationId, connection.id, scopes, now);
  });
}

async function revokeConnectionById(organizationId: string, connectionId: string, now: Date) {
  await getSystemDb().transaction(async (tx) => {
    await tx
      .update(schema.aiConnection)
      .set({ revokedAt: now })
      .where(and(eq(schema.aiConnection.organizationId, organizationId), eq(schema.aiConnection.id, connectionId)));
    await tx
      .update(schema.aiToken)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.aiToken.organizationId, organizationId),
          eq(schema.aiToken.connectionId, connectionId),
          isNull(schema.aiToken.revokedAt)
        )
      );
  });
}

/**
 * RFC 7009: la app cierra su conexión (la persona la desconectó desde
 * Claude o ChatGPT). Cualquier llave de la conexión la cierra entera.
 * Siempre «ok» (no confirma si la llave existía).
 */
export async function revokeByToken(token: string): Promise<void> {
  const [row] = await getSystemDb()
    .select({ organizationId: schema.aiToken.organizationId, connectionId: schema.aiToken.connectionId })
    .from(schema.aiToken)
    .where(eq(schema.aiToken.tokenHash, hashToken(token)))
    .limit(1);
  if (row) await revokeConnectionById(row.organizationId, row.connectionId, new Date());
}

/** Para la lista de Ajustes: ¿qué alcance pidió la app? (la pantalla de aceptar). */
export function requestedScopes(params: AuthorizeParams): Scope[] {
  return normalizeScopes((params.scope ?? "read write").split(/\s+/).filter(Boolean));
}
