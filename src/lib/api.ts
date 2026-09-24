import { z } from "zod";
import { requireSession, UnauthorizedError, type SessionContext } from "@/lib/auth/session";
import { can, type Permission } from "@/lib/auth/permissions";

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
    try {
      return await handler(session, ...args);
    } catch (err) {
      console.error("[api] error no controlado:", err);
      return apiError(500, "internal", "Error interno");
    }
  };
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
