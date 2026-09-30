import { describeError } from "@/lib/log-safe";
import { currentOrganizationId } from "@/lib/request-context";

/**
 * Fase 1 multitenant (H27) — el ÚNICO camino a los logs del servidor.
 *
 * Cada línea lleva `org=<id>` cuando hay organización (explícita en `org` o
 * la del contexto de la request), para investigar un incidente de UN negocio
 * sin mezclar los de los demás:
 *
 *   [webhook] mensaje descartado: sin identidad org=org_123 msg=wamid.X
 *
 * Qué NUNCA va aquí (constitución I): contenido de mensajes, teléfonos,
 * nombres, tokens, salida cruda del LLM, ni errores crudos (con drizzle traen
 * el SQL y sus parámetros). Por eso:
 *  - `err` pasa SIEMPRE por `describeError`;
 *  - los campos extra solo admiten escalares, pensados para ids internos
 *    (`cv_…`, `wamid…`, `bk_…`), códigos y conteos.
 * Un test estático (`tests/unit/log-guard.test.ts`) prohíbe `console.*` en el
 * código de servidor fuera de este archivo.
 */
export type LogFields = {
  /** Organización; si falta, la del contexto de la request (si hay). */
  org?: string | null;
  /** Error: se registra con describeError, jamás crudo. */
  err?: unknown;
} & Record<string, string | number | boolean | null | undefined | unknown>;

type Level = "info" | "warn" | "error";

const MAX_FIELD = 120;

function valor(v: unknown): string {
  const s = String(v).replace(/\s+/g, " ");
  const corto = s.length > MAX_FIELD ? `${s.slice(0, MAX_FIELD)}…` : s;
  return /[\s="]/.test(corto) ? JSON.stringify(corto) : corto;
}

export function formatLogLine(scope: string, message: string, fields: LogFields = {}): string {
  const { org, err, ...rest } = fields;
  const organizationId = org === undefined ? currentOrganizationId() : org;
  // Avisos redactados de antemano ya traen su `[scope]`: no se repite.
  const texto = message.startsWith(`[${scope}] `) ? message.slice(scope.length + 3) : message;
  const partes = [`[${scope}] ${texto}`];
  if (organizationId) partes.push(`org=${organizationId}`);
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    if (v !== null && typeof v === "object") continue; // solo escalares
    partes.push(`${k}=${valor(v)}`);
  }
  if (err !== undefined) partes.push(`err=${valor(describeError(err))}`);
  return partes.join(" ");
}

function emit(level: Level, scope: string, message: string, fields?: LogFields): void {
  const line = formatLogLine(scope, message, fields);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function logger(scope: string) {
  return {
    info: (message: string, fields?: LogFields) => emit("info", scope, message, fields),
    warn: (message: string, fields?: LogFields) => emit("warn", scope, message, fields),
    error: (message: string, fields?: LogFields) => emit("error", scope, message, fields),
  };
}
