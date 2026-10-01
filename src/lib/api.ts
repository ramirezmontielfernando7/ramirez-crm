import { z } from "zod";
import { requireSession, UnauthorizedError, type SessionContext } from "@/lib/auth/session";
import { can, type Permission } from "@/lib/auth/permissions";
import { logger } from "@/lib/log";
import { runWithOrganization } from "@/lib/request-context";

const log = logger("api");

/** Respuesta de error estándar de la API interna (contrato api.md). */
export function apiError(
  status: number,
  code: string,
  message: string
): Response {
  return Response.json({ error: { code, message } }, { status });
}

/** 403 estándar de la matriz de permisos (020). */
export function forbidden(): Response {
  return apiError(403, "forbidden", "No tienes permiso para esta acción");
}

/**
 * 020 — Para rutas con acciones mixtas (p. ej. el PATCH de un lead que mueve
 * etapa —cualquiera con acceso— o reasigna —solo quien reparte—): devuelve
 * el 403 listo, o null si puede.
 */
export function requirePermission(
  session: SessionContext,
  permission: Permission
): Response | null {
  return can(session, permission) ? null : forbidden();
}

/**
 * Envuelve un route handler autenticado: resuelve la sesión (401 si no hay),
 * valida el permiso de la ruta en el SERVIDOR (403, antes de tocar nada),
 * captura errores no controlados (500 sin stack) y deja pasar Response.
 */
export function withAuth<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>,
  options: { permission?: Permission } = {}
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    let session: SessionContext;
    try {
      session = await requireSession();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return apiError(401, "unauthorized", "No autenticado");
      }
      throw err;
    }
    if (options.permission && !can(session, options.permission)) {
      return forbidden();
    }
    // H27: todo lo que registre el handler (y lo que llame) lleva la
    // organización de la sesión.
    return runWithOrganization(session.organizationId, async () => {
      try {
        return await handler(session, ...args);
      } catch (err) {
        // Fase 3: credenciales guardadas que no se pueden abrir (llave de
        // cifrado faltante o equivocada). No es un 500 "misterioso": se dice
        // qué pasa, sin ningún valor secreto.
        const unreadable = credentialsUnreadable(err);
        if (unreadable) return unreadable;
        // Sin el error crudo: con drizzle 0.45 su mensaje trae el SQL y los
        // parámetros (teléfonos, textos). El logger usa `describeError`.
        log.error("error no controlado", { err });
        return apiError(500, "internal", "Error interno");
      }
    });
  };
}

/**
 * `CredentialUnavailableError` de `src/server/credentials` (por nombre, para
 * no atar `lib` a `server`) → 503 con un mensaje que dice qué hacer.
 */
export function credentialsUnreadable(err: unknown): Response | null {
  if (!(err instanceof Error) || err.name !== "CredentialUnavailableError") return null;
  const code = (err as Error & { code?: string }).code;
  const kind = (err as Error & { kind?: string }).kind ?? "la conexión";
  if (code === "reconnect_required") return null;
  log.error("credenciales que no se pueden leer", { tipo: kind, code });
  return apiError(
    503,
    "credentials_unreadable",
    `Las credenciales guardadas de ${kind} no se pueden leer con la llave de cifrado actual. ` +
      "Avisa a quien administra la plataforma (ENCRYPTION_KEY / ENCRYPTION_KEY_OLD) o vuelve a guardar la conexión."
  );
}

/** Parsea el body JSON con un esquema Zod; inválido → Response 422. */
export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: apiError(422, "invalid_body", "El body debe ser JSON válido"),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      response: apiError(422, "invalid_body", detail),
    };
  }
  return { ok: true, data: parsed.data };
}
