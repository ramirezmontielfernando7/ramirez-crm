import { createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request } from "node:https";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  ACCESS_PREFIX,
  ACCESS_TTL_MS,
  CLIENT_PREFIX,
  CODE_PREFIX,
  CODE_TTL_MS,
  REFRESH_PREFIX,
  REFRESH_REUSE_GRACE_MS,
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

const MCP_RESOURCE = () => `${getEnv().APP_BASE_URL.replace(/\/+$/, "")}/api/mcp`;

/**
 * El `resource` (RFC 8707) que manda la app: el conector (`…/api/mcp`) o el
 * dominio mismo (algunas apps mandan la raíz). Cualquier otro sitio, no.
 */
function isOurResource(raw: string): boolean {
  const r = raw.trim().replace(/\/+$/, "");
  const base = getEnv().APP_BASE_URL.replace(/\/+$/, "");
  return r === MCP_RESOURCE() || r === base;
}

type OAuthClient = { clientId: string; clientName: string; redirectUris: string[] };

/* ---------- Registro dinámico (RFC 7591) ---------- */

export const registerSchema = z.object({
  client_name: z.string().trim().min(1).max(100).optional(),
  redirect_uris: z.array(z.string().max(500)).min(1).max(10),
  // ChatGPT y otras apps mandan aquí cualquier valor: se ignora y se responde «none» (cliente público con PKCE).
  token_endpoint_auth_method: z.string().max(60).optional(),
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
  // Un nombre largo se recorta (no tumba la conexión): solo se muestra en la pantalla de aceptar.
  client_name: z.string().trim().min(1).max(500).transform((n) => n.slice(0, 100)).optional(),
  redirect_uris: z.array(z.string().max(500)).min(1).max(50),
});

/**
 * ChatGPT publica sus metadatos en chatgpt.com, detrás de una protección
 * anti-bots que a veces rechaza a un servidor (403 o un reto en HTML). Si no
 * se pueden leer, se reconoce SOLO su forma oficial y se aceptan SOLO sus
 * dos regresos oficiales, en chatgpt.com: el código jamás sale hacia otro
 * sitio, así que no abre nada que el documento no habría abierto.
 * https://developers.openai.com/apps-sdk/build/auth
 */
const CHATGPT_CIMD = /^https:\/\/chatgpt\.com\/oauth\/(?:([A-Za-z0-9_-]{1,100})\/)?client\.json$/;

export function chatGptFallbackClient(clientId: string): OAuthClient | null {
  const m = CHATGPT_CIMD.exec(clientId);
  if (!m) return null;
  const redirectUris = ["https://chatgpt.com/connector_platform_oauth_redirect"];
  if (m[1]) redirectUris.push(`https://chatgpt.com/connector/oauth/${m[1]}`);
  return { clientId, clientName: "ChatGPT", redirectUris };
}

// Rangos no globales del registro IANA: privados, compartidos, locales,
// documentación, pruebas, transición y reservados. BlockList normaliza IPv6
// y compara también las IPv4 mapeadas, incluidas sus formas hexadecimales.
const nonGlobalV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) nonGlobalV4.addSubnet(network, prefix, "ipv4");
const mappedV4 = new BlockList();
mappedV4.addSubnet("::ffff:0:0", 96, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const nonGlobalV6 = new BlockList();
nonGlobalV6.addSubnet("2001::", 23, "ipv6");
nonGlobalV6.addSubnet("2001:db8::", 32, "ipv6");
nonGlobalV6.addSubnet("2002::", 16, "ipv6");
nonGlobalV6.addSubnet("3fff::", 20, "ipv6");

/** Falla cerrado: solo se permite un destino de Internet global. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return nonGlobalV4.check(ip, "ipv4");
  if (family !== 6) return true;
  if (mappedV4.check(ip, "ipv6")) return nonGlobalV4.check(ip, "ipv6");
  return !globalV6.check(ip, "ipv6") || nonGlobalV6.check(ip, "ipv6");
}

const CIMD_MAX_BYTES = 64_000;
const CIMD_TIMEOUT_MS = 5_000;

async function fetchCimd(clientId: string): Promise<OAuthClient | null> {
  try {
    const url = new URL(clientId);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const family = isIP(hostname);
    const addrs = family ? [{ address: hostname, family }] : await lookup(hostname, { all: true });
    if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) return null;
    const address = addrs[0]!;
    const text = await new Promise<string>((resolve, reject) => {
      // URL/Host y SNI siguen siendo los del cliente; solo la resolución se fija.
      // Sin pool compartido, redirecciones ni otra resolución DNS al conectar.
      const req = request(url, {
        agent: false,
        family: address.family,
        servername: family ? undefined : hostname,
        rejectUnauthorized: true,
        lookup: (_host, _options, callback) => callback(null, address.address, address.family),
        headers: { accept: "application/json" },
      }, (res) => {
        res.on("error", reject);
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error("CIMD HTTP status"));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > CIMD_MAX_BYTES) {
            req.destroy(new Error("CIMD too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("aborted", () => reject(new Error("CIMD aborted")));
      });
      const timeout = setTimeout(() => req.destroy(new Error("CIMD timeout")), CIMD_TIMEOUT_MS);
      req.on("error", reject);
      req.on("close", () => clearTimeout(timeout));
      req.end();
    });
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
  if (isCimdClientId(clientId)) {
    const fetched = await fetchCimd(clientId);
    if (fetched) {
      // ChatGPT: su documento manda, pero sus regresos oficiales siempre valen.
      const official = chatGptFallbackClient(clientId);
      if (!official) return fetched;
      return { ...fetched, redirectUris: [...new Set([...fetched.redirectUris, ...official.redirectUris])] };
    }
    return chatGptFallbackClient(clientId);
  }
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
  // ChatGPT manda un `state` largo (cifrado): con 500 se rechazaba la solicitud.
  state: z.string().max(4000).optional(),
  scope: z.string().max(500).optional(),
  resource: z.string().max(500).optional(),
});
type AuthorizeParams = z.infer<typeof authorizeSchema>;

/**
 * Lo que la pantalla necesita para mostrar «X quiere actuar como tú», o el
 * motivo por el que no se puede (sin redirigir a una URI no registrada).
 */
export async function checkAuthorizeRequest(
  params: AuthorizeParams
): Promise<{ ok: true; client: OAuthClient } | { ok: false; reason: "client" | "redirect_uri" | "resource" }> {
  const client = await resolveClient(params.client_id);
  const reason = !client
    ? "client"
    : !client.redirectUris.includes(params.redirect_uri)
      ? "redirect_uri"
      : params.resource && !isOurResource(params.resource)
        ? "resource"
        : null;
  if (!client || reason) {
    // Para diagnosticar desde los registros por qué una app no pudo entrar (sin llaves ni datos de nadie).
    log.warn("solicitud de inicio de sesión de una app de IA rechazada", {
      reason,
      client: safeHost(params.client_id),
      redirect: safeHost(params.redirect_uri),
    });
    return { ok: false, reason: reason ?? "client" };
  }
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

type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};
type TokenError = { error: "invalid_grant" | "invalid_request" | "invalid_client" | "invalid_target"; description: string };

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
  if (input.resource && !isOurResource(input.resource)) {
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
  if (connection.revokedAt || (token.expiresAt && token.expiresAt <= now)) {
    return { error: "invalid_grant", description: "La conexión se cerró o la llave caducó" };
  }
  if (!(await stillAllowed(connection.organizationId, connection.userId))) {
    return { error: "invalid_grant", description: "Esta persona ya no puede conectar su IA" };
  }
  const scopes = normalizeScopes(connection.scopes);
  if (token.revokedAt) {
    // Reúso dentro de la gracia: la misma app renovando dos veces (ChatGPT). Otro par, sin cerrar nada.
    if (withinGrace(token.revokedAt, now)) {
      log.info("renovación repetida dentro de la gracia", { org: connection.organizationId, connection: connection.id });
      return db.transaction((tx) => issuePair(tx, connection.organizationId, connection.id, scopes, now));
    }
    // Reúso de una llave rotada hace rato: alguien más la tiene.
    await revokeConnectionById(connection.organizationId, connection.id, now);
    log.warn("llave de renovación reutilizada: conexión revocada", { org: connection.organizationId, connection: connection.id });
    return { error: "invalid_grant", description: "Llave de renovación ya usada: conexión cerrada por seguridad" };
  }
  const pair = await db.transaction(async (tx) => {
    const [consumed] = await tx
      .update(schema.aiToken)
      .set({ revokedAt: now })
      .where(and(eq(schema.aiToken.id, token.id), isNull(schema.aiToken.revokedAt)))
      .returning({ id: schema.aiToken.id });
    // Otra petición pudo consumirla después del SELECT. Solo el ganador emite.
    if (!consumed) return null;
    return issuePair(tx, connection.organizationId, connection.id, scopes, now);
  });
  if (pair) return pair;
  // Otra petición la consumió en este mismo instante: la misma app renovando en paralelo (gracia).
  log.info("renovación repetida dentro de la gracia", { org: connection.organizationId, connection: connection.id });
  return db.transaction((tx) => issuePair(tx, connection.organizationId, connection.id, scopes, now));
}

function withinGrace(revokedAt: Date, now: Date): boolean {
  return now.getTime() - revokedAt.getTime() < REFRESH_REUSE_GRACE_MS;
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
