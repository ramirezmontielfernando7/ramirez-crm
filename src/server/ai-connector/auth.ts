import { bearerToken, resourceMetadataUrl, roleMayConnect, type Scope } from "@/lib/ai-connector";
import { sessionContext, type SessionContext } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { runWithOrganization } from "@/lib/request-context";
import { resolveMembership } from "@/server/auth/on-signup";
import { isOrgActive } from "@/server/platform-admin/org-status";
import { orgHasConectorIa } from "@/server/modules";
import { delegatedGrants } from "@/server/team-chat/settings";
import { getConnectorSettings } from "@/server/ai-connector/settings";
import { resolveToken, touchConnection } from "@/server/ai-connector/keys";

/**
 * 047 — Autenticación del conector de IA (`/api/mcp`). La llave dice la
 * organización y la PERSONA; con ellas se arma la misma sesión que esa
 * persona tendría en el CRM (rol de su membresía de HOY y delegaciones), así
 * que las herramientas usan las consultas de siempre con su alcance.
 *
 * La llave deja de abrir en cuanto: se revoca, caduca, la persona sale de la
 * organización, la organización se suspende, /platform apaga el complemento,
 * el Propietario apaga el conector o deja fuera su rol.
 */

/** Por conexión: 120 llamadas por minuto (2/s sostenidos). */
export const MCP_BUDGET = { windowMs: 60_000, max: 120 };
/** Llaves FALLIDAS por IP: 30/min y luego 429 (como `/api/bot/*`). */
export const MCP_AUTH_FAILURES = { windowMs: 60_000, max: 30 };

export type McpAuth =
  | { ok: true; session: SessionContext; connectionId: string; scopes: Scope[]; assistantName: string | null }
  | { ok: false; response: Response };

function jsonError(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error: code, error_description: message }, { status, headers });
}

/** 401 con el puntero a los metadatos (RFC 9728 §5.1): así la IA sabe dónde iniciar sesión. */
export function unauthorized(message = "Falta una llave válida de Dashfort"): Response {
  const metadata = resourceMetadataUrl(getEnv().APP_BASE_URL);
  return jsonError(401, "invalid_token", message, {
    "WWW-Authenticate": `Bearer resource_metadata="${metadata}"`,
  });
}

export async function requireMcpToken(req: Request): Promise<McpAuth> {
  const token = bearerToken(req.headers.get("authorization"));
  const resolved = token ? await resolveToken(token) : null;
  if (!resolved) {
    const fails = checkRateLimit(`mcp-fail:${clientIp(req.headers)}`, MCP_AUTH_FAILURES);
    return {
      ok: false,
      response: fails.allowed ? unauthorized() : jsonError(429, "rate_limited", "Demasiados intentos fallidos"),
    };
  }
  const { organizationId, userId, connectionId, scopes } = resolved;
  if (!(await isOrgActive(organizationId))) {
    return { ok: false, response: unauthorized("La organización está suspendida") };
  }
  // La membresía de HOY: si la sacaron de la organización, su llave ya no vale.
  const membership = await resolveMembership(userId, organizationId);
  if (!membership || membership.organizationId !== organizationId) {
    return { ok: false, response: unauthorized("Esta persona ya no es parte de la organización") };
  }
  const allowed = await runWithOrganization(organizationId, async () => {
    if (!(await orgHasConectorIa(organizationId))) return false;
    return roleMayConnect(membership.role, await getConnectorSettings(organizationId));
  });
  if (!allowed) {
    return {
      ok: false,
      response: jsonError(403, "connector_off", "El conector de IA está apagado para tu rol o tu organización"),
    };
  }
  const rl = checkRateLimit(`mcp:${connectionId}`, MCP_BUDGET);
  if (!rl.allowed) {
    return { ok: false, response: jsonError(429, "rate_limited", "Demasiadas solicitudes: espera un minuto") };
  }
  const grants = await runWithOrganization(organizationId, () => delegatedGrants(organizationId, membership.role));
  await runWithOrganization(organizationId, () => touchConnection(connectionId, organizationId));
  return {
    ok: true,
    session: sessionContext(userId, organizationId, membership.role, grants),
    connectionId,
    scopes,
    assistantName: resolved.assistantName,
  };
}
