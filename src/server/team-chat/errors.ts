import { apiError } from "@/lib/api";
import { describeError } from "@/lib/log-safe";

/**
 * 025 — Errores de negocio del chat de equipo, con su status HTTP. Un recurso
 * ajeno es SIEMPRE 404 (no se confirma que exista); 403 solo cuando la
 * persona sí ve el hilo pero no puede hacer eso (p. ej. la supervisión, que
 * es de solo lectura, o editar el mensaje de otro).
 */
export class TeamChatError extends Error {
  constructor(
    public status: 403 | 404 | 409 | 413 | 415 | 422,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "TeamChatError";
  }
}

export const notFound = () =>
  new TeamChatError(404, "not_found", "No existe o no tienes acceso");

/**
 * Convierte cualquier error de un handler del chat en una respuesta. Los de
 * negocio salen tal cual; los demás (BD incluida: con drizzle 0.45 llegan
 * envueltos en DrizzleQueryError, código real en `cause`) se registran con
 * `describeError` — sin SQL, parámetros ni textos — y responden 500.
 */
export function teamChatErrorResponse(err: unknown, where: string): Response {
  if (err instanceof TeamChatError) return apiError(err.status, err.code, err.message);
  console.error(`[team-chat] ${where}:`, describeError(err));
  return apiError(500, "internal", "No se pudo completar la acción. Intenta de nuevo.");
}

/** ¿Es una violación de UNIQUE de Postgres? (mira `cause`, drizzle 0.45). */
export function isUniqueViolation(err: unknown): boolean {
  const code = (e: unknown) =>
    typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  const cause = typeof err === "object" && err !== null ? (err as { cause?: unknown }).cause : undefined;
  return code(cause) === "23505" || code(err) === "23505";
}
